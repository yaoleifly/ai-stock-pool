"""Build the live Trump Policy Pressure Index payload.

Fast-moving market inputs refresh from Yahoo Finance. Slower political and
inflation inputs retain their native publication cadence and expose freshness
metadata so the UI never presents them as intraday data.
"""

from __future__ import annotations

import html
import json
import math
import re
import threading
import time
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path
from statistics import fmean
from urllib.parse import quote, urlencode

from curl_cffi import requests as curl_requests


BASE_DIR = Path(__file__).resolve().parent
FALLBACK_FILE = BASE_DIR / "tpi-latest.json"
CROWDING_HISTORY_FILE = BASE_DIR / "institutional-crowding-history.json"
POLICY_CACHE_SECONDS = 300
CROWDING_BENCHMARK = "SOXX"

MARKET_SOURCES = {
    "ust10y": ("^TNX", "10年期美债", 0.15),
    "move": ("^MOVE", "债券波动率", 0.15),
    "spx": ("^GSPC", "标普500", 0.20),
    "vix": ("^VIX", "股市恐慌", 0.15),
}

SOURCE_URLS = {
    "approval": "https://pollfinity.com/averages",
    "inflation": "https://www.clevelandfed.org/indicators-and-data/inflation-nowcasting",
    "ust10y": "https://finance.yahoo.com/quote/%5ETNX/",
    "move": "https://finance.yahoo.com/quote/%5EMOVE/",
    "spx": "https://finance.yahoo.com/quote/%5EGSPC/",
    "vix": "https://finance.yahoo.com/quote/%5EVIX/",
}

POLICY_EVENT_QUERIES = {
    "tariff": {
        "name": "关税与贸易",
        "query": "Trump tariffs trade exemption delay deal",
        "poolCategories": ["半导体设备", "半导体材料", "先进封装", "PCB与材料"],
    },
    "technology": {
        "name": "科技与出口管制",
        "query": "Trump semiconductor AI export controls sanctions waiver",
        "poolCategories": ["AI算力与服务器", "半导体与设备", "ASIC与网络芯片", "数据存储"],
    },
    "geopolitical": {
        "name": "军事与地缘",
        "query": "Trump military strike ceasefire talks sanctions",
        "poolCategories": ["太空与国防", "国防军工", "能源", "能源与核电"],
    },
    "fiscal": {
        "name": "财政、税收与产业补贴",
        "query": "Trump tax spending budget manufacturing subsidy policy",
        "poolCategories": ["数据中心基础设施", "电力设备", "能源与核电", "半导体设备"],
    },
}

CROWDING_WATCHLIST = {
    "MU": "Micron",
    "NVDA": "NVIDIA",
    "AMD": "AMD",
    "AVGO": "Broadcom",
    "MRVL": "Marvell",
    "SMCI": "Super Micro",
}

HARDLINE_TERMS = (
    "tariff", "sanction", "strike", "ban", "block", "crackdown", "threat", "impose",
    "escalat", "restrict", "retaliat", "ultimatum",
)
SOFTENING_TERMS = (
    "delay", "pause", "exemption", "waiver", "talks", "deal", "ease", "withdraw",
    "suspend", "ceasefire", "settlement", "extend", "rollback",
)
EXECUTION_TERMS = (
    "takes effect", "implemented", "signed", "enacted", "effective", "executive order",
    "final rule", "approved",
)

INDUSTRY_MAPPING = [
    {
        "sector": "本土制造与关税链",
        "stance": "观察",
        "signal": "等待政策确认",
        "text": "指数高位会增加延期与豁免的可能性，但只有正式政策文本才能确认。先看订单、补贴与本土产能兑现。",
        "poolCategories": ["半导体设备", "半导体与设备", "半导体材料", "电子特气"],
    },
    {
        "sector": "长久期成长",
        "stance": "等回踩",
        "signal": "利率与波动率约束",
        "text": "政策压力上升常伴随利率和波动率抬升，估值可能先于基本面承压。等待风险溢价与利率回落。",
        "poolCategories": ["云与软件", "互联网平台", "加密与区块链"],
    },
    {
        "sector": "国防与能源",
        "stance": "观察",
        "signal": "事件脉冲与降级并存",
        "text": "地缘事件带来交易脉冲，高压力又可能推动谈判与降级。优先区分真实订单和纯主题交易。",
        "poolCategories": ["太空与国防", "国防军工", "能源", "能源与核电", "核能"],
    },
    {
        "sector": "AI基础设施",
        "stance": "能下手",
        "signal": "基本面优先",
        "text": "政策噪音中，优先选择需求、资本开支和订单证据更强的基础设施环节，并结合行情位置分批处理。",
        "poolCategories": ["数据中心基础设施", "AI算力与服务器", "数据存储", "光子学与光通信", "光通信"],
    },
]

_cache_lock = threading.Lock()
_cache: dict[str, object] = {"timestamp": 0.0, "payload": None}


def clamp(value: float, lower: float = 0.0, upper: float = 100.0) -> float:
    return min(upper, max(lower, value))


def finite_number(value: object) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def score_label(score: float) -> str:
    if score >= 75:
        return "极高"
    if score >= 60:
        return "偏高"
    if score >= 40:
        return "中性"
    return "偏低"


def escaped_raw_value(text: str, key: str) -> float | None:
    marker = f'{key}\\":{{\\"raw\\":'
    start = text.find(marker)
    if start < 0:
        return None
    tail = text[start + len(marker):]
    match = re.match(r"-?\d+(?:\.\d+)?", tail)
    return finite_number(match.group(0)) if match else None


def escaped_string_value(text: str, key: str) -> str | None:
    marker = f'{key}\\":\\"'
    start = text.find(marker)
    if start < 0:
        return None
    tail = text[start + len(marker):]
    end = tail.find('\\"')
    return tail[:end] if end >= 0 else None


def escaped_json_value(text: str, key: str) -> object | None:
    """Decode a Yahoo embedded JSON value without depending on CSS or table HTML."""
    markers = ((f'{key}\\":', True), (f'"{key}":', False))
    decoder = json.JSONDecoder()
    for marker, escaped in markers:
        start = text.find(marker)
        if start < 0:
            continue
        fragment = text[start + len(marker):]
        if escaped:
            fragment = fragment.replace('\\"', '"')
        try:
            value, _ = decoder.raw_decode(fragment)
            return value
        except json.JSONDecodeError:
            continue
    return None


def raw_number(value: object) -> float | None:
    if isinstance(value, dict):
        return finite_number(value.get("raw"))
    return finite_number(value)


def percent_change(current: float | None, prior: float | None) -> float | None:
    if current is None or prior in (None, 0):
        return None
    return round((current / prior - 1) * 100, 1)


def parse_expectation_trend(text: str) -> dict[str, object]:
    payload = escaped_json_value(text, "earningsTrend")
    rows = payload.get("trend", []) if isinstance(payload, dict) else []
    periods = []
    for row in rows:
        if not isinstance(row, dict) or row.get("period") not in {"0q", "+1q", "0y", "+1y"}:
            continue
        eps_trend = row.get("epsTrend") if isinstance(row.get("epsTrend"), dict) else {}
        revenue = row.get("revenueEstimate") if isinstance(row.get("revenueEstimate"), dict) else {}
        current_eps = raw_number(eps_trend.get("current"))
        eps_30d = raw_number(eps_trend.get("30daysAgo"))
        eps_60d = raw_number(eps_trend.get("60daysAgo"))
        periods.append(
            {
                "period": row.get("period"),
                "endDate": row.get("endDate"),
                "eps": {
                    "current": current_eps,
                    "value30dAgo": eps_30d,
                    "value60dAgo": eps_60d,
                    "change30d": percent_change(current_eps, eps_30d),
                    "change60d": percent_change(current_eps, eps_60d),
                },
                "revenue": {
                    "current": raw_number(revenue.get("avg")),
                    "value30dAgo": None,
                    "value60dAgo": None,
                    "change30d": None,
                    "change60d": None,
                    "historyStatus": "collecting",
                },
            }
        )
    primary = next((row for row in periods if row["period"] == "0q"), periods[0] if periods else None)
    return {
        "primaryPeriod": primary.get("period") if primary else None,
        "primary": primary,
        "periods": periods,
        "method": "EPS修正来自Yahoo当前、30日前和60日前一致预期；收入修正由每日时点快照计算。",
    }


def parse_calendar_events(text: str) -> dict[str, object]:
    payload = escaped_json_value(text, "calendarEvents")
    earnings = payload.get("earnings", {}) if isinstance(payload, dict) else {}

    def first_date(key: str) -> str | None:
        values = earnings.get(key) if isinstance(earnings, dict) else None
        if not isinstance(values, list) or not values:
            return None
        raw = raw_number(values[0])
        return iso_from_timestamp(raw) if raw is not None else values[0].get("fmt")

    call_date = first_date("earningsCallDate")
    call_is_future = False
    if call_date:
        try:
            call_is_future = datetime.fromisoformat(call_date.replace("Z", "+00:00")) > datetime.now(timezone.utc)
        except ValueError:
            call_is_future = False
    return {
        "lastCallDate": None if call_is_future else call_date,
        "nextCallDate": call_date if call_is_future else None,
        "nextReportDate": first_date("earningsDate"),
        "nextDateEstimated": bool(earnings.get("isEarningsDateEstimate")) if isinstance(earnings, dict) else None,
    }


def parse_target_events(text: str, days: int = 365) -> list[dict[str, object]]:
    payload = escaped_json_value(text, "upgradeDowngradeHistory")
    history = payload.get("history", []) if isinstance(payload, dict) else []
    cutoff = int((datetime.now(timezone.utc) - timedelta(days=days)).timestamp())
    events = []
    for row in history:
        if not isinstance(row, dict):
            continue
        epoch = int(raw_number(row.get("epochGradeDate")) or 0)
        if epoch < cutoff:
            continue
        target_action = str(row.get("priceTargetAction") or "").lower()
        if target_action == "raises":
            event_type, label = "target_raise", "上调目标价"
        elif target_action == "lowers":
            event_type, label = "target_cut", "下调目标价"
        else:
            action = str(row.get("action") or "").lower()
            event_type = "rating_change" if action in {"up", "down", "init"} else "reiterate"
            label = "评级调整" if event_type == "rating_change" else "维持评级"
        events.append(
            {
                "date": iso_from_timestamp(epoch),
                "epoch": epoch,
                "firm": row.get("firm") or "",
                "type": event_type,
                "label": label,
                "toGrade": row.get("toGrade") or "",
                "fromGrade": row.get("fromGrade") or "",
                "currentTarget": raw_number(row.get("currentPriceTarget")),
                "priorTarget": raw_number(row.get("priorPriceTarget")),
            }
        )
    return sorted(events, key=lambda item: int(item["epoch"]))


def parse_recommendation_trend(text: str) -> list[dict[str, object]]:
    payload = escaped_json_value(text, "recommendationTrend")
    rows = payload.get("trend", []) if isinstance(payload, dict) else []
    parsed_rows = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        parsed_rows.append(
            {
                "period": row.get("period"),
                "strongBuy": int(raw_number(row.get("strongBuy")) or 0),
                "buy": int(raw_number(row.get("buy")) or 0),
                "hold": int(raw_number(row.get("hold")) or 0),
                "sell": int(raw_number(row.get("sell")) or 0),
                "strongSell": int(raw_number(row.get("strongSell")) or 0),
            }
        )
    if parsed_rows:
        return parsed_rows

    start = text.find("recommendationTrend")
    if start < 0:
        return []
    end = text.find("upgradeDowngradeHistory", start)
    segment = text[start:end if end >= 0 else start + 10000].replace('\\"', '"')
    pattern = re.compile(
        r'\{"period":"([^"]+)","strongBuy":(\d+),"buy":(\d+),'
        r'"hold":(\d+),"sell":(\d+),"strongSell":(\d+)\}'
    )
    rows = []
    seen = set()
    for match in pattern.finditer(segment):
        period = match.group(1)
        if period in seen:
            continue
        seen.add(period)
        rows.append(
            {
                "period": period,
                "strongBuy": int(match.group(2)),
                "buy": int(match.group(3)),
                "hold": int(match.group(4)),
                "sell": int(match.group(5)),
                "strongSell": int(match.group(6)),
            }
        )
    return rows


def parse_target_actions(text: str, days: int = 45) -> dict[str, int]:
    structured_events = parse_target_events(text, days=days)
    if structured_events:
        return {
            "raises": sum(item["type"] == "target_raise" for item in structured_events),
            "cuts": sum(item["type"] == "target_cut" for item in structured_events),
            "reiterates": sum(item["type"] in {"reiterate", "rating_change"} for item in structured_events),
        }
    start = text.rfind("upgradeDowngradeHistory")
    if start < 0:
        return {"raises": 0, "cuts": 0, "reiterates": 0}
    segment = text[start:start + 180000].replace('\\"', '"')
    cutoff = int((datetime.now(timezone.utc) - timedelta(days=days)).timestamp())
    pattern = re.compile(
        r'"epochGradeDate":(\d+).*?"action":"([^"]+)"'
        r'(?:.*?"priceTargetAction":"([^"]+)")?',
        flags=re.DOTALL,
    )
    raises = cuts = reiterates = 0
    for match in pattern.finditer(segment):
        if int(match.group(1)) < cutoff:
            continue
        target_action = (match.group(3) or "").lower()
        if target_action == "raises":
            raises += 1
        elif target_action == "lowers":
            cuts += 1
        else:
            reiterates += 1
    return {"raises": raises, "cuts": cuts, "reiterates": reiterates}


def parse_analyst_page(text: str) -> dict[str, object]:
    target_mean = escaped_raw_value(text, "targetMeanPrice")
    recommendation_mean = escaped_raw_value(text, "recommendationMean")
    analyst_count = escaped_raw_value(text, "numberOfAnalystOpinions")
    recommendation_key = escaped_string_value(text, "recommendationKey")
    trends = parse_recommendation_trend(text)
    if target_mean is None or not trends:
        raise ValueError("analyst consensus fields unavailable")
    target_events = parse_target_events(text)
    return {
        "targetMean": target_mean,
        "targetMedian": escaped_raw_value(text, "targetMedianPrice"),
        "targetLow": escaped_raw_value(text, "targetLowPrice"),
        "targetHigh": escaped_raw_value(text, "targetHighPrice"),
        "recommendationMean": recommendation_mean,
        "analystCount": int(analyst_count or 0),
        "recommendationKey": recommendation_key or "unknown",
        "trend": trends,
        "targetActions": parse_target_actions(text),
        "targetEvents": target_events,
        "expectations": parse_expectation_trend(text),
        "earningsCalendar": parse_calendar_events(text),
    }


def period_bullish_share(row: dict[str, object] | None) -> float | None:
    if not row:
        return None
    bullish = int(row.get("strongBuy", 0)) + int(row.get("buy", 0))
    total = bullish + int(row.get("hold", 0)) + int(row.get("sell", 0)) + int(row.get("strongSell", 0))
    return bullish / total if total else None


def compute_crowding_score(
    analyst: dict[str, object],
    current_price: float,
    return_5d: float,
    return_20d: float,
    drawdown_3m: float,
) -> dict[str, object]:
    trend_by_period = {str(item.get("period")): item for item in analyst.get("trend", [])}
    bullish_share = period_bullish_share(trend_by_period.get("0m"))
    prior_bullish_share = period_bullish_share(trend_by_period.get("-3m"))
    target_mean = float(analyst.get("targetMean") or current_price)
    target_upside = (target_mean / current_price - 1) * 100 if current_price else 0.0
    actions = analyst.get("targetActions") or {}
    raises = int(actions.get("raises", 0))
    cuts = int(actions.get("cuts", 0))
    expectations = analyst.get("expectations") if isinstance(analyst.get("expectations"), dict) else {}
    primary_expectation = expectations.get("primary") if isinstance(expectations, dict) else None
    primary_expectation = primary_expectation if isinstance(primary_expectation, dict) else {}
    eps_expectation = primary_expectation.get("eps") if isinstance(primary_expectation.get("eps"), dict) else {}
    eps_change_30d = finite_number(eps_expectation.get("change30d"))
    eps_change_60d = finite_number(eps_expectation.get("change60d"))

    consensus_score = clamp(((bullish_share or 0.5) - 0.55) / 0.35 * 100)
    target_score = clamp((target_upside - 5) / 35 * 100)
    action_total = raises + cuts
    revision_score = clamp(50 + ((raises - cuts) / action_total * 50 if action_total else 0))
    price_weakness = clamp(max(-return_5d * 7, -return_20d * 3.5, -drawdown_3m * 2.5, 0))
    consensus_sticky = (
        bullish_share is not None
        and prior_bullish_share is not None
        and bullish_share >= prior_bullish_share - 0.02
    )
    lag_score = price_weakness * (0.7 if consensus_sticky or raises >= cuts else 0.4)
    score = clamp(
        consensus_score * 0.30
        + target_score * 0.20
        + revision_score * 0.20
        + lag_score * 0.30
    )
    evidence = []
    if consensus_score >= 70:
        evidence.append("买入评级高度一致")
    if target_score >= 60:
        evidence.append("目标价隐含空间偏乐观")
    if revision_score >= 70 and raises >= 2:
        evidence.append("近期目标价集中上调")
    if raises > cuts and any(value is not None and value < 0 for value in (eps_change_30d, eps_change_60d)):
        evidence.append("目标价上调但EPS预期下调")
    # A deep drawdown with sticky ratings is already a meaningful divergence even
    # when the latest five sessions bounce. 45 roughly corresponds to a 25%+
    # three-month drawdown after the stickiness discount.
    if lag_score >= 45:
        evidence.append("股价走弱但评级尚未松动")

    if score >= 75 and len(evidence) >= 2 and lag_score >= 45:
        zone = "distribution_risk"
        label = "派发风险"
    elif score >= 60:
        zone = "crowded"
        label = "一致预期拥挤"
    elif score >= 40:
        zone = "watch"
        label = "观察背离"
    else:
        zone = "balanced"
        label = "分歧仍在"
    return {
        "score": round(score, 1),
        "zone": zone,
        "label": label,
        "evidence": evidence,
        "metrics": {
            "bullishShare": round((bullish_share or 0) * 100, 1),
            "bullishShare3mAgo": round(prior_bullish_share * 100, 1) if prior_bullish_share is not None else None,
            "targetMean": round(target_mean, 2),
            "targetMedian": round(float(analyst.get("targetMedian") or target_mean), 2),
            "targetLow": round(float(analyst.get("targetLow") or target_mean), 2),
            "targetHigh": round(float(analyst.get("targetHigh") or target_mean), 2),
            "targetUpside": round(target_upside, 1),
            "return5d": round(return_5d, 1),
            "return20d": round(return_20d, 1),
            "drawdown3m": round(drawdown_3m, 1),
            "targetRaises45d": raises,
            "targetCuts45d": cuts,
            "analystCount": int(analyst.get("analystCount") or 0),
            "epsChange30d": eps_change_30d,
            "epsChange60d": eps_change_60d,
        },
        "expectations": expectations,
    }


def percentile_rank(values: list[float], current: float) -> float:
    clean = [value for value in values if math.isfinite(value)]
    if not clean:
        return 50.0
    below = sum(value < current for value in clean)
    equal = sum(value == current for value in clean)
    return clamp((below + equal * 0.5) / len(clean) * 100)


def iso_from_timestamp(timestamp: int | float | None) -> str | None:
    if not timestamp:
        return None
    return datetime.fromtimestamp(float(timestamp), timezone.utc).isoformat()


def freshness(updated_at: str | None, fast: bool = False) -> tuple[str, str]:
    if not updated_at:
        return "unknown", "更新时间未知"
    try:
        updated = datetime.fromisoformat(updated_at.replace("Z", "+00:00"))
        if updated.tzinfo is None:
            updated = updated.replace(tzinfo=timezone.utc)
        age_hours = max(0.0, (datetime.now(timezone.utc) - updated).total_seconds() / 3600)
    except ValueError:
        return "unknown", updated_at
    if fast:
        if age_hours <= 24:
            return "live", "最新交易时点"
        if age_hours <= 96:
            return "delayed", "最近交易日"
        return "stale", "数据偏旧"
    if age_hours <= 24 * 7:
        return "current", "跟随源站更新"
    if age_hours <= 24 * 35:
        return "delayed", "低频数据"
    return "stale", "数据偏旧"


def fetch_market_series(driver_id: str, symbol: str) -> dict[str, object]:
    response = curl_requests.get(
        f"https://query1.finance.yahoo.com/v8/finance/chart/{quote(symbol)}",
        params={"range": "1y", "interval": "1d", "includePrePost": "false", "events": "div,splits"},
        impersonate="chrome",
        timeout=14,
    )
    response.raise_for_status()
    chart = response.json().get("chart", {})
    result_rows = chart.get("result") or []
    if chart.get("error") or not result_rows:
        raise ValueError(str(chart.get("error") or f"{symbol} empty response"))
    result = result_rows[0]
    meta = result.get("meta", {})
    timestamps = result.get("timestamp") or []
    quote_rows = result.get("indicators", {}).get("quote") or []
    closes = quote_rows[0].get("close") if quote_rows else []
    volumes = quote_rows[0].get("volume") if quote_rows else []
    records = []
    for index, (timestamp, close) in enumerate(zip(timestamps, closes)):
        clean_close = finite_number(close)
        if clean_close is None:
            continue
        volume = finite_number(volumes[index]) if index < len(volumes) else None
        records.append(
            {
                "timestamp": int(timestamp),
                "date": datetime.fromtimestamp(int(timestamp), timezone.utc).date().isoformat(),
                "close": float(clean_close),
                "volume": int(volume) if volume is not None else None,
            }
        )
    points = [(int(item["timestamp"]), float(item["close"])) for item in records]
    if len(points) < 25:
        raise ValueError(f"{symbol} insufficient history")
    regular_price = finite_number(meta.get("regularMarketPrice"))
    current = regular_price if regular_price is not None else points[-1][1]
    prior_index = max(0, len(points) - 6)
    prior = points[prior_index][1]
    updated_at = iso_from_timestamp(meta.get("regularMarketTime") or points[-1][0])
    return {
        "id": driver_id,
        "symbol": symbol,
        "current": current,
        "prior5d": prior,
        "updatedAt": updated_at,
        "points": points,
        "closes": [point[1] for point in points],
        "records": records,
    }


def return_between_dates(records: list[dict[str, object]], start_date: str, end_date: str) -> float | None:
    usable = [item for item in records if start_date <= str(item.get("date")) <= end_date]
    if len(usable) < 2:
        return None
    start = finite_number(usable[0].get("close"))
    end = finite_number(usable[-1].get("close"))
    return percent_change(end, start)


def build_earnings_window(
    market: dict[str, object],
    benchmark: dict[str, object] | None,
    earnings_date: str | None,
) -> dict[str, object]:
    records = list(market.get("records") or [])
    if not earnings_date or len(records) < 25:
        return {"status": "unavailable", "reason": "缺少最近财报日期或行情序列"}
    event_day = earnings_date[:10]
    event_index = max((index for index, item in enumerate(records) if str(item.get("date")) <= event_day), default=-1)
    if event_index < 0 or event_index >= len(records) - 1:
        return {"status": "unavailable", "reason": "财报事件尚未形成价格窗口", "eventDate": event_day}
    baseline = records[event_index]
    benchmark_records = list(benchmark.get("records") or []) if benchmark else []

    def window(days: int) -> dict[str, float | None]:
        end_index = min(event_index + days, len(records) - 1)
        end_record = records[end_index]
        stock_return = percent_change(
            finite_number(end_record.get("close")),
            finite_number(baseline.get("close")),
        )
        sector_return = return_between_dates(benchmark_records, str(baseline.get("date")), str(end_record.get("date")))
        excess = round(stock_return - sector_return, 1) if stock_return is not None and sector_return is not None else None
        return {"stock": stock_return, "sector": sector_return, "excess": excess}

    day_1 = window(1)
    day_5 = window(5)
    day_20 = window(20)
    reaction_index = min(event_index + 1, len(records) - 1)
    prior_volumes = [
        finite_number(item.get("volume"))
        for item in records[max(0, event_index - 20):event_index]
        if finite_number(item.get("volume")) is not None
    ]
    reaction_volume = finite_number(records[reaction_index].get("volume"))
    average_volume = fmean(prior_volumes) if prior_volumes else None
    volume_ratio = round(reaction_volume / average_volume, 2) if reaction_volume and average_volume else None
    excess_20d = finite_number(day_20.get("excess"))
    stock_20d = finite_number(day_20.get("stock"))
    if excess_20d is not None and excess_20d <= -8 and (volume_ratio or 0) >= 1.4:
        classification = "company_specific_distribution"
        label = "公司特异性派发"
        explanation = "财报后显著跑输SOXX且反应日放量，不能仅用行业去杠杆解释。"
    elif excess_20d is not None and excess_20d <= -5:
        classification = "company_specific_weakness"
        label = "公司特异性走弱"
        explanation = "财报后明显跑输SOXX，公司自身预期差占主导。"
    elif stock_20d is not None and stock_20d <= -5 and excess_20d is not None and abs(excess_20d) < 3:
        classification = "sector_driven"
        label = "行业因素主导"
        explanation = "个股与SOXX同步走弱，暂不把回撤单独归因于公司基本面。"
    elif excess_20d is not None and excess_20d >= 3:
        classification = "relative_strength"
        label = "财报后相对强势"
        explanation = "财报后跑赢SOXX，机构乐观仍有价格确认。"
    else:
        classification = "mixed"
        label = "混合驱动"
        explanation = "行业与公司因素交织，等待更完整的20日事件窗口。"
    return {
        "status": "complete" if event_index + 20 < len(records) else "developing",
        "eventDate": event_day,
        "benchmark": CROWDING_BENCHMARK,
        "day1": day_1,
        "day5": day_5,
        "day20": day_20,
        "reactionVolumeRatio": volume_ratio,
        "classification": classification,
        "label": label,
        "explanation": explanation,
    }


def build_downgrade_lag(
    market: dict[str, object],
    target_events: list[dict[str, object]],
    drawdown_trigger: float = -15.0,
) -> dict[str, object]:
    records = list(market.get("records") or [])[-90:]
    if len(records) < 20:
        return {"status": "unavailable", "reason": "行情历史不足"}
    peak_index = max(range(len(records)), key=lambda index: float(records[index].get("close") or 0))
    peak = records[peak_index]
    peak_price = finite_number(peak.get("close"))
    break_record = None
    for record in records[peak_index + 1:]:
        drawdown = percent_change(finite_number(record.get("close")), peak_price)
        if drawdown is not None and drawdown <= drawdown_trigger:
            break_record = record
            break
    if not break_record:
        return {
            "status": "not_triggered",
            "peakDate": peak.get("date"),
            "peakPrice": peak_price,
            "label": "尚未触发15%回撤",
        }
    break_date = str(break_record.get("date"))
    first_cut = next(
        (item for item in target_events if item.get("type") == "target_cut" and str(item.get("date", ""))[:10] >= break_date),
        None,
    )
    break_dt = datetime.fromisoformat(break_date).date()
    if first_cut:
        cut_date = str(first_cut.get("date"))[:10]
        lag_days = (datetime.fromisoformat(cut_date).date() - break_dt).days
        return {
            "status": "cut_after_price",
            "peakDate": peak.get("date"),
            "breakDate": break_date,
            "firstCutDate": cut_date,
            "lagDays": lag_days,
            "label": f"股价先跌，目标价晚{lag_days}天才下调",
        }
    current_drawdown = percent_change(finite_number(records[-1].get("close")), peak_price)
    if current_drawdown is not None and current_drawdown > drawdown_trigger:
        return {
            "status": "recovered_without_cut",
            "peakDate": peak.get("date"),
            "breakDate": break_date,
            "firstCutDate": None,
            "lagDays": None,
            "currentDrawdown": current_drawdown,
            "label": f"曾触发回撤，现已修复至{current_drawdown:.1f}%",
        }
    waiting_days = (datetime.now(timezone.utc).date() - break_dt).days
    return {
        "status": "waiting_for_cut",
        "peakDate": peak.get("date"),
        "breakDate": break_date,
        "firstCutDate": None,
        "lagDays": None,
        "waitingDays": waiting_days,
        "label": f"股价已先跌{waiting_days}天，机构尚未下调",
    }


def build_price_timeline(
    market: dict[str, object],
    benchmark: dict[str, object] | None,
    limit: int = 100,
) -> list[dict[str, object]]:
    records = list(market.get("records") or [])[-limit:]
    benchmark_by_date = {
        str(item.get("date")): finite_number(item.get("close"))
        for item in (benchmark.get("records") or [] if benchmark else [])
    }
    first_price = finite_number(records[0].get("close")) if records else None
    first_benchmark = next(
        (benchmark_by_date.get(str(item.get("date"))) for item in records if benchmark_by_date.get(str(item.get("date"))) is not None),
        None,
    )
    timeline = []
    for item in records:
        date = str(item.get("date"))
        price = finite_number(item.get("close"))
        benchmark_price = benchmark_by_date.get(date)
        timeline.append(
            {
                "date": date,
                "price": round(price, 2) if price is not None else None,
                "priceIndex": round(price / first_price * 100, 2) if price is not None and first_price else None,
                "sectorIndex": round(benchmark_price / first_benchmark * 100, 2)
                if benchmark_price is not None and first_benchmark else None,
                "volume": item.get("volume"),
            }
        )
    return timeline


def fetch_institutional_crowding(
    ticker: str,
    company: str,
    benchmark: dict[str, object] | None = None,
) -> dict[str, object]:
    analysis_url = f"https://finance.yahoo.com/quote/{quote(ticker)}/analysis/"
    response = curl_requests.get(analysis_url, impersonate="chrome", timeout=18)
    response.raise_for_status()
    analyst = parse_analyst_page(response.text)
    market = fetch_market_series(f"crowding_{ticker.lower()}", ticker)
    closes = list(market["closes"])
    current = float(market["current"])
    return_5d = (current / closes[-6] - 1) * 100 if len(closes) >= 6 and closes[-6] else 0.0
    return_20d = (current / closes[-21] - 1) * 100 if len(closes) >= 21 and closes[-21] else 0.0
    recent_high = max(closes[-63:]) if closes else current
    drawdown_3m = (current / recent_high - 1) * 100 if recent_high else 0.0
    scored = compute_crowding_score(analyst, current, return_5d, return_20d, drawdown_3m)
    earnings_calendar = analyst.get("earningsCalendar") if isinstance(analyst.get("earningsCalendar"), dict) else {}
    target_events = list(analyst.get("targetEvents") or [])
    return {
        "ticker": ticker,
        "company": company,
        "currentPrice": round(current, 2),
        "updatedAt": market.get("updatedAt"),
        "sourceName": "Yahoo Finance Analysis + Market Data",
        "sourceUrl": analysis_url,
        "earningsCalendar": earnings_calendar,
        "earningsWindow": build_earnings_window(market, benchmark, earnings_calendar.get("lastCallDate")),
        "downgradeLag": build_downgrade_lag(market, target_events),
        "targetEvents": target_events[-60:],
        "priceTimeline": build_price_timeline(market, benchmark),
        **scored,
    }


def google_news_rss_url(query_text: str) -> str:
    query_string = urlencode({"q": query_text, "hl": "en-US", "gl": "US", "ceid": "US:en"})
    return f"https://news.google.com/rss/search?{query_string}"


def classify_event_phase(text: str) -> str:
    normalized = text.lower()
    hardline = sum(term in normalized for term in HARDLINE_TERMS)
    softening = sum(term in normalized for term in SOFTENING_TERMS)
    execution = sum(term in normalized for term in EXECUTION_TERMS)
    if execution > max(hardline, softening):
        return "execution"
    if softening > hardline:
        return "softening"
    if hardline:
        return "escalation"
    return "monitoring"


def fetch_policy_event_feed(event_id: str) -> dict[str, object]:
    config = POLICY_EVENT_QUERIES[event_id]
    url = google_news_rss_url(str(config["query"]))
    response = curl_requests.get(url, impersonate="chrome", timeout=16)
    response.raise_for_status()
    root = ET.fromstring(response.content)
    items = []
    phase_counts = {"escalation": 0, "softening": 0, "execution": 0, "monitoring": 0}
    for item in root.findall("./channel/item")[:8]:
        title = (item.findtext("title") or "").strip()
        link = (item.findtext("link") or "").strip()
        published = (item.findtext("pubDate") or "").strip()
        source_node = item.find("source")
        source_name = (source_node.text or "Google News") if source_node is not None else "Google News"
        published_at = None
        if published:
            try:
                published_at = parsedate_to_datetime(published).astimezone(timezone.utc).isoformat()
            except (TypeError, ValueError):
                published_at = published
        phase = classify_event_phase(title)
        phase_counts[phase] += 1
        items.append(
            {
                "title": title,
                "url": link,
                "source": source_name,
                "publishedAt": published_at,
                "phase": phase,
            }
        )
    directional = {key: phase_counts[key] for key in ("escalation", "softening", "execution")}
    phase = max(directional, key=directional.get) if max(directional.values(), default=0) else "monitoring"
    return {
        "id": event_id,
        "name": config["name"],
        "phase": phase,
        "phaseCounts": phase_counts,
        "items": items[:4],
        "poolCategories": config["poolCategories"],
        "sourceName": "Google News RSS",
        "sourceUrl": url,
        "updatedAt": datetime.now(timezone.utc).isoformat(),
    }


def fetch_approval() -> dict[str, object]:
    response = curl_requests.get("https://pollfinity.com/averages.json", impersonate="chrome", timeout=14)
    response.raise_for_status()
    track = response.json().get("tracks", {}).get("trump_approval", {})
    polls = track.get("polls_used") or []
    valid_polls = []
    for poll in polls:
        approve = finite_number(poll.get("approve"))
        disapprove = finite_number(poll.get("disapprove"))
        weight = finite_number(poll.get("weight"))
        if approve is None or disapprove is None or weight is None or weight <= 0:
            continue
        if not (25 <= approve <= 75 and 25 <= disapprove <= 75 and approve + disapprove >= 80):
            continue
        valid_polls.append((approve, disapprove, weight))
    if not valid_polls:
        current = track.get("current") or {}
        approve = finite_number(current.get("approve"))
        disapprove = finite_number(current.get("disapprove"))
        if approve is None or disapprove is None:
            raise ValueError("approval average unavailable")
        valid_polls = [(approve, disapprove, 1.0)]
    total_weight = sum(item[2] for item in valid_polls)
    approve = sum(item[0] * item[2] for item in valid_polls) / total_weight
    disapprove = sum(item[1] * item[2] for item in valid_polls) / total_weight
    net = approve - disapprove
    history = []
    for item in track.get("history") or []:
        hist_approve = finite_number(item.get("approve"))
        hist_disapprove = finite_number(item.get("disapprove"))
        if hist_approve is None or hist_disapprove is None:
            continue
        if 25 <= hist_approve <= 75 and 25 <= hist_disapprove <= 75 and hist_approve + hist_disapprove >= 80:
            history.append({"date": item.get("date"), "net": hist_approve - hist_disapprove})
    updated = track.get("last_updated")
    updated_at = f"{updated}T12:00:00+00:00" if updated else None
    return {
        "approve": approve,
        "disapprove": disapprove,
        "net": net,
        "updatedAt": updated_at,
        "pollCount": len(valid_polls),
        "history": history,
    }


def strip_tags(value: str) -> str:
    return html.unescape(re.sub(r"<[^>]+>", "", value)).strip()


def fetch_inflation_nowcast() -> dict[str, object]:
    response = curl_requests.get(SOURCE_URLS["inflation"], impersonate="chrome", timeout=18)
    response.raise_for_status()
    match = re.search(
        r"<caption>\s*Inflation,\s*year-over-year percent change\s*</caption>.*?<tbody>\s*<tr>(.*?)</tr>",
        response.text,
        flags=re.IGNORECASE | re.DOTALL,
    )
    if not match:
        raise ValueError("inflation nowcast table unavailable")
    cells = [strip_tags(cell) for cell in re.findall(r"<td[^>]*>(.*?)</td>", match.group(1), flags=re.DOTALL)]
    if len(cells) < 6:
        raise ValueError("inflation nowcast row incomplete")
    cpi_yoy = finite_number(cells[1])
    if cpi_yoy is None:
        raise ValueError("CPI nowcast unavailable")
    month_match = re.search(r"(\d{4})", cells[0])
    year = int(month_match.group(1)) if month_match else datetime.now(timezone.utc).year
    updated_at = None
    date_match = re.match(r"(\d{1,2})/(\d{1,2})", cells[5])
    if date_match:
        updated_at = datetime(year, int(date_match.group(1)), int(date_match.group(2)), 12, tzinfo=timezone.utc).isoformat()
    return {
        "period": cells[0],
        "cpiYoY": cpi_yoy,
        "coreCpiYoY": finite_number(cells[2]),
        "updatedAt": updated_at,
    }


def market_driver_payload(driver_id: str, raw: dict[str, object]) -> dict[str, object]:
    current = float(raw["current"])
    prior = float(raw["prior5d"])
    closes = list(raw["closes"])
    updated_at = raw.get("updatedAt")
    freshness_code, freshness_label = freshness(str(updated_at) if updated_at else None, fast=True)
    weight = MARKET_SOURCES[driver_id][2]

    if driver_id == "spx":
        change = (current / prior - 1) * 100 if prior else 0.0
        historical_returns = [-(closes[index] / closes[index - 5] - 1) * 100 for index in range(5, len(closes))]
        score = percentile_rank(historical_returns, -change)
        value = f"{current:,.1f}"
        change_label = f"近5日 {change:+.2f}%"
        pressure_direction = "下跌增加压力"
        interpretation = "股市回撤会强化政策反馈；上涨则释放压力。"
    elif driver_id == "ust10y":
        change = current - prior
        score = 0.75 * percentile_rank(closes, current) + 0.25 * clamp(50 + change * 180)
        value = f"{current:.3f}%"
        change_label = f"近5日 {change * 100:+.0f}bp"
        pressure_direction = "收益率上升增加压力"
        interpretation = "融资成本越高，财政与市场承受力越弱。"
    else:
        change = current - prior
        multiplier = 3.0 if driver_id == "vix" else 1.0
        score = 0.78 * percentile_rank(closes, current) + 0.22 * clamp(50 + change * multiplier)
        value = f"{current:.2f}"
        change_label = f"近5日 {change:+.2f}"
        pressure_direction = "指数上升增加压力"
        interpretation = "波动率抬升意味着政策冲击更难被市场消化。"

    return {
        "id": driver_id,
        "name": MARKET_SOURCES[driver_id][1],
        "weight": weight,
        "pressureScore": round(clamp(score), 1),
        "value": value,
        "changeLabel": change_label,
        "direction": pressure_direction,
        "interpretation": interpretation,
        "updatedAt": updated_at,
        "freshness": freshness_code,
        "freshnessLabel": freshness_label,
        "sourceName": "Yahoo Finance 市场数据",
        "sourceTier": "market",
        "sourceUrl": SOURCE_URLS[driver_id],
    }


def approval_driver_payload(raw: dict[str, object]) -> dict[str, object]:
    net = float(raw["net"])
    history = raw.get("history") or []
    prior_net = None
    if history:
        prior_net = finite_number(history[max(0, len(history) - 11)].get("net"))
    change = net - prior_net if prior_net is not None else None
    score = clamp(50 + (-net - 5) * 1.8)
    updated_at = raw.get("updatedAt")
    freshness_code, freshness_label = freshness(str(updated_at) if updated_at else None)
    return {
        "id": "approval",
        "name": "净支持率",
        "weight": 0.25,
        "pressureScore": round(score, 1),
        "value": f"{net:+.1f}pt",
        "changeLabel": f"较约30日前 {change:+.1f}pt" if change is not None else f"{raw.get('pollCount', 0)}项有效民调",
        "direction": "净支持率下降增加压力",
        "interpretation": "民调越弱，强硬政策的政治承受空间越小。",
        "updatedAt": updated_at,
        "freshness": freshness_code,
        "freshnessLabel": freshness_label,
        "sourceName": f"Pollfinity 聚合 · {raw.get('pollCount', 0)}项有效民调",
        "sourceTier": "aggregator",
        "sourceUrl": SOURCE_URLS["approval"],
    }


def inflation_driver_payload(raw: dict[str, object]) -> dict[str, object]:
    cpi_yoy = float(raw["cpiYoY"])
    score = clamp(50 + (cpi_yoy - 2.0) * 20)
    updated_at = raw.get("updatedAt")
    freshness_code, freshness_label = freshness(str(updated_at) if updated_at else None)
    return {
        "id": "inflation",
        "name": "CPI Nowcast",
        "weight": 0.10,
        "pressureScore": round(score, 1),
        "value": f"{cpi_yoy:.2f}%",
        "changeLabel": f"{raw.get('period', '')} 同比预测",
        "direction": "通胀预期上升增加压力",
        "interpretation": "输入性通胀越高，关税和财政政策的民意成本越大。",
        "updatedAt": updated_at,
        "freshness": freshness_code,
        "freshnessLabel": freshness_label,
        "sourceName": "克利夫兰联储 Inflation Nowcasting",
        "sourceTier": "official",
        "sourceUrl": SOURCE_URLS["inflation"],
    }


def build_pressure_breakdown(drivers: list[dict[str, object]]) -> list[dict[str, object]]:
    scores = {str(item["id"]): float(item["pressureScore"]) for item in drivers}
    groups = [
        {
            "id": "political",
            "name": "政治承受力",
            "score": scores.get("approval", 50.0),
            "components": ["净支持率"],
            "interpretation": "衡量民调是否压缩强硬政策的政治空间。",
        },
        {
            "id": "rates",
            "name": "利率与财政约束",
            "score": scores.get("ust10y", 50.0),
            "components": ["10年期美债"],
            "interpretation": "衡量融资成本与财政扩张的市场约束。",
        },
        {
            "id": "market",
            "name": "市场与波动压力",
            "score": fmean([scores.get("move", 50.0), scores.get("spx", 50.0), scores.get("vix", 50.0)]),
            "components": ["MOVE", "标普500", "VIX"],
            "interpretation": "衡量风险资产和波动率是否形成即时反馈。",
        },
        {
            "id": "inflation",
            "name": "通胀约束",
            "score": scores.get("inflation", 50.0),
            "components": ["CPI Nowcast"],
            "interpretation": "衡量政策是否会进一步推高居民成本。",
        },
    ]
    for group in groups:
        group["score"] = round(float(group["score"]), 1)
        group["level"] = score_label(float(group["score"]))
    return groups


def event_pressure_interaction(event: dict[str, object], index_value: float) -> str:
    phase = event.get("phase")
    if phase == "softening":
        return "已出现软化措辞，需等待延期、豁免或正式协议确认。"
    if phase == "execution":
        return "政策进入执行阶段，市场压力不再等同于政策会立即撤回。"
    if phase == "escalation" and index_value >= 60:
        return "强硬升级与高压力并存，最容易出现高波动和后续政策修正。"
    if phase == "escalation":
        return "政策仍有推进空间，不能只因市场回撤就预判软化。"
    return "目前以监测为主，等待明确政策文本或行动。"


def decorate_policy_events(events: list[dict[str, object]], index_value: float) -> list[dict[str, object]]:
    labels = {
        "escalation": "强硬升级",
        "softening": "软化/谈判",
        "execution": "进入执行",
        "monitoring": "持续监测",
    }
    output = []
    for event in events:
        output.append(
            {
                **event,
                "phaseLabel": labels.get(str(event.get("phase")), "持续监测"),
                "pressureInteraction": event_pressure_interaction(event, index_value),
            }
        )
    return output


def load_crowding_history() -> dict[str, object]:
    if not CROWDING_HISTORY_FILE.exists():
        return {"version": "1.0", "updatedAt": None, "snapshots": []}
    try:
        with CROWDING_HISTORY_FILE.open("r", encoding="utf-8") as handle:
            payload = json.load(handle)
    except (OSError, json.JSONDecodeError):
        return {"version": "1.0", "updatedAt": None, "snapshots": []}
    if not isinstance(payload.get("snapshots"), list):
        payload["snapshots"] = []
    return payload


def ticker_history(history: dict[str, object], ticker: str) -> list[dict[str, object]]:
    output = []
    for snapshot in history.get("snapshots", []):
        if not isinstance(snapshot, dict):
            continue
        row = next(
            (item for item in snapshot.get("rows", []) if isinstance(item, dict) and item.get("ticker") == ticker),
            None,
        )
        if row:
            output.append({"date": snapshot.get("date"), **row})
    return sorted(output, key=lambda item: str(item.get("date") or ""))


def latest_crowding_snapshot_rows(history: dict[str, object]) -> dict[str, dict[str, object]]:
    snapshots = [item for item in history.get("snapshots", []) if isinstance(item, dict)]
    for snapshot in reversed(snapshots):
        rows = snapshot.get("rows") if isinstance(snapshot.get("rows"), list) else []
        by_ticker = {
            str(item.get("ticker")): {"date": snapshot.get("date"), "asOf": snapshot.get("asOf"), **item}
            for item in rows
            if isinstance(item, dict) and item.get("ticker")
        }
        if all(ticker in by_ticker for ticker in CROWDING_WATCHLIST):
            return by_ticker
    return {}


def snapshot_fallback_row(
    ticker: str,
    company: str,
    snapshot: dict[str, object],
    reason: str | None = None,
) -> dict[str, object]:
    return {
        "ticker": ticker,
        "company": company,
        "currentPrice": snapshot.get("currentPrice"),
        "updatedAt": snapshot.get("asOf"),
        "sourceName": "Institutional crowding point-in-time snapshot",
        "sourceUrl": "",
        "earningsCalendar": {},
        "earningsWindow": {"status": "snapshot_only", "reason": "实时分析页不可用，使用最新机构一致性快照补齐覆盖。"},
        "downgradeLag": {"status": "snapshot_only", "label": "实时目标价事件不可用，使用快照保留覆盖。"},
        "targetEvents": [],
        "priceTimeline": [],
        "score": snapshot.get("score"),
        "zone": snapshot.get("zone"),
        "label": score_label(finite_number(snapshot.get("score"))),
        "evidence": [f"使用{snapshot.get('date')}机构一致性快照补齐覆盖"],
        "metrics": {
            "targetMean": snapshot.get("targetMean"),
            "targetMedian": snapshot.get("targetMedian"),
            "bullishShare": snapshot.get("bullishShare"),
            "targetRaises45d": snapshot.get("targetRaises45d"),
            "targetCuts45d": snapshot.get("targetCuts45d"),
            "epsChange30d": None,
            "epsChange60d": None,
            "revenueChange30d": None,
            "revenueChange60d": None,
        },
        "expectations": {
            "method": "point_in_time_snapshot",
            "primary": {
                "eps": {"current": snapshot.get("epsEstimate"), "historyStatus": "snapshot_only"},
                "revenue": {"current": snapshot.get("revenueEstimate"), "historyStatus": "snapshot_only"},
            },
        },
        "fallback": {"status": "snapshot", "reason": reason},
    }


def fill_missing_crowding_rows(
    rows: list[dict[str, object]],
    errors: dict[str, str],
    history: dict[str, object],
) -> list[dict[str, object]]:
    present = {str(row.get("ticker")) for row in rows}
    snapshot_rows = latest_crowding_snapshot_rows(history)
    output = list(rows)
    for ticker, company in CROWDING_WATCHLIST.items():
        if ticker in present or ticker not in snapshot_rows:
            continue
        output.append(snapshot_fallback_row(ticker, company, snapshot_rows[ticker], errors.get(ticker)))
    return output


def historical_point(rows: list[dict[str, object]], days_ago: int) -> dict[str, object] | None:
    cutoff = datetime.now(timezone.utc).date() - timedelta(days=days_ago)
    eligible = []
    for row in rows:
        try:
            row_date = datetime.fromisoformat(str(row.get("date"))).date()
        except ValueError:
            continue
        if row_date <= cutoff:
            eligible.append(row)
    return eligible[-1] if eligible else None


def apply_crowding_history(row: dict[str, object], history: dict[str, object]) -> dict[str, object]:
    ticker = str(row.get("ticker") or "")
    rows = ticker_history(history, ticker)
    expectations = row.get("expectations") if isinstance(row.get("expectations"), dict) else {}
    primary = expectations.get("primary") if isinstance(expectations, dict) else None
    primary = primary if isinstance(primary, dict) else {}
    revenue = primary.get("revenue") if isinstance(primary.get("revenue"), dict) else {}
    current_revenue = finite_number(revenue.get("current"))
    point_30 = historical_point(rows, 30)
    point_60 = historical_point(rows, 60)

    def snapshot_revenue(point: dict[str, object] | None) -> float | None:
        return finite_number(point.get("revenueEstimate")) if point else None

    revenue_30 = snapshot_revenue(point_30)
    revenue_60 = snapshot_revenue(point_60)
    if revenue:
        revenue.update(
            {
                "value30dAgo": revenue_30,
                "value60dAgo": revenue_60,
                "change30d": percent_change(current_revenue, revenue_30),
                "change60d": percent_change(current_revenue, revenue_60),
                "historyStatus": "ready" if revenue_30 is not None else "collecting",
            }
        )
    metrics = row.get("metrics") if isinstance(row.get("metrics"), dict) else {}
    metrics["revenueChange30d"] = revenue.get("change30d") if revenue else None
    metrics["revenueChange60d"] = revenue.get("change60d") if revenue else None
    prior_7d = historical_point(rows, 7)
    prior_score = finite_number(prior_7d.get("score")) if prior_7d else None
    current_score = finite_number(row.get("score"))
    row["scoreChange7d"] = round(current_score - prior_score, 1) if current_score is not None and prior_score is not None else None
    row["historyStatus"] = {
        "points": len(rows),
        "firstDate": rows[0].get("date") if rows else None,
        "lastDate": rows[-1].get("date") if rows else None,
        "revenue30dReady": revenue_30 is not None,
        "revenue60dReady": revenue_60 is not None,
    }
    row["dailyHistory"] = rows[-120:]
    target_actions = metrics.get("targetRaises45d", 0), metrics.get("targetCuts45d", 0)
    eps_down = any(
        finite_number(metrics.get(key)) is not None and float(metrics[key]) < 0
        for key in ("epsChange30d", "epsChange60d")
    )
    revenue_down = any(
        finite_number(metrics.get(key)) is not None and float(metrics[key]) < 0
        for key in ("revenueChange30d", "revenueChange60d")
    )
    target_up = int(target_actions[0] or 0) > int(target_actions[1] or 0)
    if target_up and (eps_down or revenue_down):
        evidence = list(row.get("evidence") or [])
        label = "目标价上调但盈利预期下调"
        if label not in evidence:
            evidence.append(label)
        row["evidence"] = evidence
        row["expectationDivergence"] = {
            "status": "warning",
            "label": label,
            "epsDown": eps_down,
            "revenueDown": revenue_down,
        }
    else:
        row["expectationDivergence"] = {
            "status": "clear" if any(value is not None for value in (
                metrics.get("epsChange30d"), metrics.get("revenueChange30d")
            )) else "collecting",
            "label": "盈利预期未与目标价形成负向背离" if not (eps_down or revenue_down) else "等待目标价方向确认",
            "epsDown": eps_down,
            "revenueDown": revenue_down,
        }
    return row


def snapshot_row(row: dict[str, object]) -> dict[str, object]:
    metrics = row.get("metrics") if isinstance(row.get("metrics"), dict) else {}
    expectations = row.get("expectations") if isinstance(row.get("expectations"), dict) else {}
    primary = expectations.get("primary") if isinstance(expectations, dict) else None
    primary = primary if isinstance(primary, dict) else {}
    eps = primary.get("eps") if isinstance(primary.get("eps"), dict) else {}
    revenue = primary.get("revenue") if isinstance(primary.get("revenue"), dict) else {}
    return {
        "ticker": row.get("ticker"),
        "score": row.get("score"),
        "zone": row.get("zone"),
        "currentPrice": row.get("currentPrice"),
        "targetMean": metrics.get("targetMean"),
        "targetMedian": metrics.get("targetMedian"),
        "bullishShare": metrics.get("bullishShare"),
        "epsEstimate": eps.get("current"),
        "revenueEstimate": revenue.get("current"),
        "targetRaises45d": metrics.get("targetRaises45d"),
        "targetCuts45d": metrics.get("targetCuts45d"),
    }


def build_crowding_payload(rows: list[dict[str, object]], errors: dict[str, str]) -> dict[str, object]:
    ranked = sorted(rows, key=lambda item: float(item.get("score", 0)), reverse=True)
    aggregate = round(fmean(float(item.get("score", 0)) for item in ranked), 1) if ranked else None
    high_risk_count = sum(float(item.get("score", 0)) >= 60 for item in ranked)
    return {
        "status": "live" if ranked and not errors else "partial" if ranked else "unavailable",
        "asOf": datetime.now(timezone.utc).isoformat(),
        "aggregateScore": aggregate,
        "aggregateLabel": score_label(aggregate) if aggregate is not None else "数据不足",
        "highRiskCount": high_risk_count,
        "coverage": {"received": len(ranked), "requested": len(CROWDING_WATCHLIST)},
        "rows": ranked,
        "errors": errors,
        "method": (
            "买入评级一致性30% / 目标价乐观度20% / 近期目标价上调集中度20% / "
            "价格走弱但评级未松动30%。EPS/收入修正、财报后SOXX超额收益与机构补降滞后作为确认层；"
            "至少两项证据同时成立，才标记派发风险。"
        ),
        "boundary": "机构拥挤度是反向风险提示，不是顶部确认，也不替代营收、利润、订单和现金流判断。",
    }


def build_scenario_matrix(index_value: float, crowding_score: float | None) -> dict[str, object]:
    policy_high = index_value >= 60
    crowding_high = crowding_score is not None and crowding_score >= 60
    scenarios = [
        {
            "id": "policy_high_crowding_high",
            "policy": "高政策压力",
            "crowding": "高机构拥挤",
            "title": "反弹不等于反转",
            "action": "政策可能软化，但拥挤交易仍可能继续去杠杆；优先减追高、验订单与现金流。",
        },
        {
            "id": "policy_high_crowding_low",
            "policy": "高政策压力",
            "crowding": "低机构拥挤",
            "title": "等待政策确认",
            "action": "关注延期、豁免、谈判等行动确认，避免只交易一句表态。",
        },
        {
            "id": "policy_low_crowding_high",
            "policy": "低政策压力",
            "crowding": "高机构拥挤",
            "title": "基本面与拥挤主导",
            "action": "不能把下跌简单归因于宏观或去杠杆；重点检查预期透支和财报后资金撤离。",
        },
        {
            "id": "policy_low_crowding_low",
            "policy": "低政策压力",
            "crowding": "低机构拥挤",
            "title": "基本面验证窗口",
            "action": "政策和仓位压力都有限，回到需求、资本开支、盈利质量与估值。",
        },
    ]
    current_id = f"policy_{'high' if policy_high else 'low'}_crowding_{'high' if crowding_high else 'low'}"
    current = next(item for item in scenarios if item["id"] == current_id)
    return {"current": current, "scenarios": scenarios}


def build_industry_mapping(index_value: float, crowding_score: float | None) -> list[dict[str, object]]:
    output = [dict(item) for item in INDUSTRY_MAPPING]
    crowding_high = crowding_score is not None and crowding_score >= 60
    for item in output:
        item["policyOverlay"] = "政策高压" if index_value >= 60 else "政策压力有限"
        item["crowdingOverlay"] = "机构拥挤偏高" if crowding_high else "机构拥挤未到高位"
        if crowding_high and item["sector"] in {"长久期成长", "AI基础设施"}:
            item["stance"] = "防拥挤"
            item["signal"] = "基本面强不等于价格安全"
            item["text"] += " 当目标价与买入评级高度一致时，财报后价格反应和资金行为优先于口头目标价。"
    return output


def load_fallback() -> dict[str, object]:
    with FALLBACK_FILE.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def fallback_driver(driver_id: str, fallback: dict[str, object], reason: str) -> dict[str, object]:
    for item in fallback.get("drivers", []):
        if item.get("id") != driver_id:
            continue
        return {
            "id": driver_id,
            "name": item.get("nameZh") or item.get("name") or driver_id,
            "weight": float(item.get("weight") or 0),
            "pressureScore": float(item.get("pressureScore") or 50),
            "value": item.get("value") or "—",
            "changeLabel": item.get("changeLabel") or "使用上次快照",
            "direction": item.get("direction") or "等待恢复",
            "interpretation": "实时源暂不可用，当前显示上次有效快照。",
            "updatedAt": fallback.get("asOf"),
            "freshness": "fallback",
            "freshnessLabel": "降级快照",
            "sourceName": f"本地回退 · {reason}",
            "sourceTier": "fallback",
            "sourceUrl": SOURCE_URLS.get(driver_id, ""),
        }
    raise ValueError(f"missing fallback driver {driver_id}")


def build_history(
    market_raw: dict[str, dict[str, object]],
    approval_score: float,
    inflation_score: float,
) -> list[dict[str, object]]:
    if not all(driver_id in market_raw for driver_id in MARKET_SOURCES):
        return []
    spx_points = list(market_raw["spx"]["points"])
    sampled = spx_points[-41::5]
    market_maps = {
        driver_id: {
            datetime.fromtimestamp(timestamp, timezone.utc).date().isoformat(): value
            for timestamp, value in raw["points"]
        }
        for driver_id, raw in market_raw.items()
    }
    histories = {driver_id: list(raw["closes"]) for driver_id, raw in market_raw.items()}
    output = []
    for timestamp, spx_value in sampled[-8:]:
        date_key = datetime.fromtimestamp(timestamp, timezone.utc).date().isoformat()
        scores: dict[str, float] = {}
        for driver_id in ("ust10y", "move", "vix"):
            value = market_maps[driver_id].get(date_key)
            if value is None:
                scores[driver_id] = 50.0
            else:
                scores[driver_id] = percentile_rank(histories[driver_id], value)
        spx_index = next((index for index, point in enumerate(spx_points) if point[0] == timestamp), None)
        if spx_index is None or spx_index < 5:
            scores["spx"] = 50.0
        else:
            prior = spx_points[spx_index - 5][1]
            return_5d = (spx_value / prior - 1) * 100
            all_returns = [-(spx_points[index][1] / spx_points[index - 5][1] - 1) * 100 for index in range(5, len(spx_points))]
            scores["spx"] = percentile_rank(all_returns, -return_5d)
        total = (
            approval_score * 0.25
            + scores["ust10y"] * 0.15
            + scores["move"] * 0.15
            + scores["spx"] * 0.20
            + scores["vix"] * 0.15
            + inflation_score * 0.10
        )
        output.append({"date": date_key, "label": date_key[5:].replace("-", "."), "value": round(total, 1)})
    return output


def fetch_crowding_dataset() -> tuple[list[dict[str, object]], dict[str, str], dict[str, object] | None]:
    benchmark = None
    errors: dict[str, str] = {}
    try:
        benchmark = fetch_market_series("crowding_benchmark", CROWDING_BENCHMARK)
    except Exception as error:
        errors[CROWDING_BENCHMARK] = str(error)
    rows: list[dict[str, object]] = []
    with ThreadPoolExecutor(max_workers=len(CROWDING_WATCHLIST)) as executor:
        futures = {
            executor.submit(fetch_institutional_crowding, ticker, company, benchmark): ticker
            for ticker, company in CROWDING_WATCHLIST.items()
        }
        for future in as_completed(futures):
            ticker = futures[future]
            try:
                rows.append(future.result())
            except Exception as error:
                errors[ticker] = str(error)
    return rows, errors, benchmark


def build_crowding_snapshot() -> dict[str, object]:
    rows, errors, _ = fetch_crowding_dataset()
    now = datetime.now(timezone.utc)
    return {
        "date": now.date().isoformat(),
        "asOf": now.isoformat(),
        "rows": [snapshot_row(row) for row in sorted(rows, key=lambda item: str(item.get("ticker")))],
        "errors": errors,
    }


def build_policy_payload() -> dict[str, object]:
    fallback = load_fallback()
    tasks = {
        "approval": fetch_approval,
        "inflation": fetch_inflation_nowcast,
        **{
            driver_id: (lambda identifier=driver_id, ticker=symbol: fetch_market_series(identifier, ticker))
            for driver_id, (symbol, _, _) in MARKET_SOURCES.items()
        },
        **{
            f"event_{event_id}": (lambda identifier=event_id: fetch_policy_event_feed(identifier))
            for event_id in POLICY_EVENT_QUERIES
        },
    }
    results: dict[str, dict[str, object]] = {}
    errors: dict[str, str] = {}
    with ThreadPoolExecutor(max_workers=6) as executor:
        future_ids = {executor.submit(task): driver_id for driver_id, task in tasks.items()}
        for future in as_completed(future_ids):
            driver_id = future_ids[future]
            try:
                results[driver_id] = future.result()
            except Exception as error:
                errors[driver_id] = str(error)

    drivers = []
    if "approval" in results:
        drivers.append(approval_driver_payload(results["approval"]))
    else:
        drivers.append(fallback_driver("approval", fallback, errors.get("approval", "source unavailable")))
    for driver_id in ("ust10y", "move", "spx", "vix"):
        if driver_id in results:
            drivers.append(market_driver_payload(driver_id, results[driver_id]))
        else:
            drivers.append(fallback_driver(driver_id, fallback, errors.get(driver_id, "source unavailable")))
    if "inflation" in results:
        drivers.append(inflation_driver_payload(results["inflation"]))
    else:
        drivers.append(fallback_driver("inflation", fallback, errors.get("inflation", "source unavailable")))

    crowding_history = load_crowding_history()
    crowding_rows, crowding_errors, crowding_benchmark = fetch_crowding_dataset()
    crowding_rows = fill_missing_crowding_rows(crowding_rows, crowding_errors, crowding_history)
    crowding_rows = [apply_crowding_history(row, crowding_history) for row in crowding_rows]
    crowding = build_crowding_payload(crowding_rows, crowding_errors)
    crowding["benchmark"] = {
        "ticker": CROWDING_BENCHMARK,
        "status": "live" if crowding_benchmark else "unavailable",
        "updatedAt": crowding_benchmark.get("updatedAt") if crowding_benchmark else None,
    }
    crowding["history"] = {
        "updatedAt": crowding_history.get("updatedAt"),
        "snapshotCount": len(crowding_history.get("snapshots", [])),
    }

    weighted_total = sum(float(item["pressureScore"]) * float(item["weight"]) for item in drivers)
    total_weight = sum(float(item["weight"]) for item in drivers) or 1.0
    index_value = round(weighted_total / total_weight, 1)
    zone = (
        "low_pressure"
        if index_value < 40
        else "neutral"
        if index_value < 60
        else "high_pressure"
        if index_value < 75
        else "extreme_pressure"
    )
    fallback_history = fallback.get("history") or []
    history = build_history(
        {key: value for key, value in results.items() if key in MARKET_SOURCES},
        float(drivers[0]["pressureScore"]),
        float(drivers[-1]["pressureScore"]),
    ) or fallback_history
    prior = finite_number(history[-2].get("value")) if len(history) > 1 else None
    change_5d = round(index_value - prior, 1) if prior is not None else 0.0
    source_health = [
        {
            "id": item["id"],
            "name": item["name"],
            "freshness": item["freshness"],
            "freshnessLabel": item["freshnessLabel"],
            "updatedAt": item["updatedAt"],
            "sourceName": item["sourceName"],
            "sourceUrl": item["sourceUrl"],
        }
        for item in drivers
    ]
    fallback_count = sum(item["freshness"] == "fallback" for item in drivers)
    event_rows = [
        results[f"event_{event_id}"]
        for event_id in POLICY_EVENT_QUERIES
        if f"event_{event_id}" in results
    ]
    policy_events = decorate_policy_events(event_rows, index_value)
    event_errors = {
        event_id: errors[f"event_{event_id}"]
        for event_id in POLICY_EVENT_QUERIES
        if f"event_{event_id}" in errors
    }
    crowding_score = finite_number(crowding.get("aggregateScore"))
    scenario_matrix = build_scenario_matrix(index_value, crowding_score)
    return {
        "asOf": datetime.now(timezone.utc).isoformat(),
        "version": "0.4-expectations-event-history",
        "status": "live" if fallback_count == 0 else "partial",
        "cacheSeconds": POLICY_CACHE_SECONDS,
        "summary": (
            "压力处于高位，重点观察政策是否出现延期、豁免或谈判措辞软化。"
            if index_value >= 60
            else "压力尚未进入高位，政策转向仍缺少足够的市场与政治约束。"
        ),
        "index": {"value": index_value, "zone": zone, "change5d": change_5d},
        "drivers": drivers,
        "pressureBreakdown": build_pressure_breakdown(drivers),
        "history": history,
        "policyEvents": policy_events,
        "policyEventErrors": event_errors,
        "institutionalCrowding": crowding,
        "scenarioMatrix": scenario_matrix,
        "industryMapping": build_industry_mapping(index_value, crowding_score),
        "sourceHealth": source_health,
        "errors": errors,
        "method": {
            "weights": "民调25% / 标普20% / 美债15% / MOVE15% / VIX15% / CPI Nowcast10%",
            "marketRefresh": "5分钟缓存，跟随最近交易时点",
            "slowRefresh": "民调和通胀跟随源站发布频率",
            "eventModel": "事件新闻只判断升级、执行、软化阶段，不直接进入压力总分",
            "crowdingModel": crowding["method"],
        },
        "disclaimer": "政策压力与机构拥挤度是两套独立信号；二者都不预测个体决策，也不构成投资建议。",
    }


def get_policy_payload(force: bool = False) -> dict[str, object]:
    now = time.time()
    with _cache_lock:
        cached = _cache.get("payload")
        cached_at = float(_cache.get("timestamp") or 0)
        if not force and cached and now - cached_at < POLICY_CACHE_SECONDS:
            return cached  # type: ignore[return-value]
    payload = build_policy_payload()
    with _cache_lock:
        _cache["payload"] = payload
        _cache["timestamp"] = now
    return payload


if __name__ == "__main__":
    print(json.dumps(get_policy_payload(force=True), ensure_ascii=False, indent=2))
