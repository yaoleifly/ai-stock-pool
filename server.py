#!/usr/bin/env python3
"""Serve the stock-pool dashboard with cached Yahoo Finance quotes."""

from __future__ import annotations

import argparse
import csv
import json
import math
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from functools import partial
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, quote, urlparse

from curl_cffi import requests as curl_requests

from mobile_briefing import build_briefing, clamp_limit, load_csv, parse_reference_ids
from policy_engine import get_policy_payload


WEB_DIR = Path(__file__).resolve().parent
POOL_FILE = WEB_DIR / "stock-pool.csv"
CACHE_TTL_SECONDS = 60


def load_pool() -> tuple[list[str], dict[str, str], dict[str, int]]:
    with POOL_FILE.open("r", encoding="utf-8-sig", newline="") as handle:
        rows = [row for row in csv.DictReader(handle) if row.get("ticker")]
    symbols = [row["ticker"].strip().upper() for row in rows]
    markets = {row["ticker"].strip().upper(): row.get("market", "美股").strip() or "美股" for row in rows}
    market_counts: dict[str, int] = {}
    for market in markets.values():
        market_counts[market] = market_counts.get(market, 0) + 1
    return symbols, markets, market_counts


SYMBOLS, SYMBOL_MARKETS, MARKET_COUNTS = load_pool()
_cache_lock = threading.Lock()
_cache: dict[str, object] = {"timestamp": 0.0, "payload": None}


def finite_number(value: object) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def currency_for_symbol(symbol: str) -> str:
    return "CNY" if SYMBOL_MARKETS.get(symbol) == "A股" else "USD"


def fetch_symbol_quote(symbol: str) -> dict[str, object]:
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{quote(symbol)}"
    response = curl_requests.get(
        url,
        params={"range": "5d", "interval": "1d", "includePrePost": "false", "events": "div,splits"},
        impersonate="chrome",
        timeout=10,
    )
    response.raise_for_status()
    chart = response.json().get("chart", {})
    if chart.get("error") or not chart.get("result"):
        raise ValueError(str(chart.get("error") or "empty Yahoo response"))

    result = chart["result"][0]
    meta = result.get("meta", {})
    timestamps = result.get("timestamp", [])
    quote_rows = result.get("indicators", {}).get("quote", [])
    if not timestamps or not quote_rows:
        raise ValueError("missing price history")

    series = quote_rows[0]
    closes = series.get("close", [])
    highs = series.get("high", [])
    lows = series.get("low", [])
    volumes = series.get("volume", [])
    valid = [index for index, value in enumerate(closes) if finite_number(value) is not None]
    if not valid:
        raise ValueError("missing close price")

    last_index = valid[-1]
    previous_index = valid[-2] if len(valid) > 1 else None
    last_price = finite_number(closes[last_index])
    previous_close = finite_number(closes[previous_index]) if previous_index is not None else None
    if last_price is None:
        raise ValueError("invalid close price")

    day_high = finite_number(highs[last_index]) if last_index < len(highs) else None
    day_low = finite_number(lows[last_index]) if last_index < len(lows) else None
    volume = finite_number(volumes[last_index]) if last_index < len(volumes) else None
    change = last_price - previous_close if previous_close else None
    change_percent = (change / previous_close * 100) if change is not None and previous_close else None

    return {
        "price": round(last_price, 4),
        "previousClose": round(previous_close, 4) if previous_close is not None else None,
        "change": round(change, 4) if change is not None else None,
        "changePercent": round(change_percent, 4) if change_percent is not None else None,
        "dayHigh": round(day_high, 4) if day_high is not None else None,
        "dayLow": round(day_low, 4) if day_low is not None else None,
        "volume": int(volume) if volume is not None else None,
        "currency": meta.get("currency") or currency_for_symbol(symbol),
        "market": SYMBOL_MARKETS.get(symbol, "美股"),
        "timestamp": datetime.fromtimestamp(timestamps[last_index], timezone.utc).isoformat(),
    }


def fetch_quotes() -> dict[str, object]:
    quotes: dict[str, object] = {}
    missing: list[str] = []

    with ThreadPoolExecutor(max_workers=16) as executor:
        future_symbols = {executor.submit(fetch_symbol_quote, symbol): symbol for symbol in SYMBOLS}
        for future in as_completed(future_symbols):
            symbol = future_symbols[future]
            try:
                quotes[symbol] = future.result()
            except Exception:
                missing.append(symbol)

    if missing:
        retry_missing: list[str] = []
        with ThreadPoolExecutor(max_workers=8) as executor:
            future_symbols = {executor.submit(fetch_symbol_quote, symbol): symbol for symbol in missing}
            for future in as_completed(future_symbols):
                symbol = future_symbols[future]
                try:
                    quotes[symbol] = future.result()
                except Exception:
                    retry_missing.append(symbol)
        missing = retry_missing

    return {
        "asOf": datetime.now(timezone.utc).isoformat(),
        "source": "Yahoo Finance chart endpoint",
        "refreshSeconds": CACHE_TTL_SECONDS,
        "requested": len(SYMBOLS),
        "received": len(quotes),
        "markets": MARKET_COUNTS,
        "missing": sorted(missing),
        "quotes": quotes,
    }


def get_quotes(force: bool = False) -> dict[str, object]:
    now = time.time()
    with _cache_lock:
        cached_payload = _cache.get("payload")
        cached_timestamp = float(_cache.get("timestamp", 0.0))
        if not force and cached_payload and now - cached_timestamp < CACHE_TTL_SECONDS:
            return cached_payload  # type: ignore[return-value]

        try:
            payload = fetch_quotes()
            _cache["payload"] = payload
            _cache["timestamp"] = now
            return payload
        except Exception as error:  # Yahoo can rate-limit or transiently fail.
            if cached_payload:
                stale = dict(cached_payload)  # type: ignore[arg-type]
                stale["stale"] = True
                stale["warning"] = str(error)
                return stale
            raise


class DashboardHandler(SimpleHTTPRequestHandler):
    def log_message(self, format_string: str, *args: object) -> None:
        print(f"[{self.log_date_time_string()}] {format_string % args}")

    def send_json(self, payload: dict[str, object], status: HTTPStatus = HTTPStatus.OK) -> None:
        body = json.dumps(payload, ensure_ascii=False, allow_nan=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/api/health":
            self.send_json(
                {
                    "ok": True,
                    "symbols": len(SYMBOLS),
                    "markets": MARKET_COUNTS,
                    "cacheSeconds": CACHE_TTL_SECONDS,
                }
            )
            return
        if parsed.path == "/api/quotes":
            try:
                force = parse_qs(parsed.query).get("refresh", ["0"])[0] == "1"
                self.send_json(get_quotes(force=force))
            except Exception as error:
                self.send_json(
                    {"error": "行情暂时不可用", "detail": str(error), "quotes": {}},
                    HTTPStatus.BAD_GATEWAY,
                )
            return
        if parsed.path == "/api/policy":
            try:
                force = parse_qs(parsed.query).get("refresh", ["0"])[0] == "1"
                self.send_json(get_policy_payload(force=force))
            except Exception as error:
                self.send_json(
                    {"status": "error", "error": "政策压力数据暂时不可用", "detail": str(error)},
                    HTTPStatus.BAD_GATEWAY,
                )
            return
        if parsed.path == "/api/mobile/briefing":
            query = parse_qs(parsed.query)
            self.send_json(
                build_briefing(
                    load_csv(WEB_DIR / "discovery-signals.csv"),
                    load_csv(POOL_FILE),
                    parse_reference_ids(query.get("reference_ids", [None])[0]),
                    clamp_limit(query.get("limit", [None])[0]),
                )
            )
            return
        super().do_GET()


def main() -> None:
    parser = argparse.ArgumentParser(description="Serve the live stock-pool dashboard")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", default=8765, type=int)
    args = parser.parse_args()

    handler = partial(DashboardHandler, directory=str(WEB_DIR))
    server = ThreadingHTTPServer((args.host, args.port), handler)
    print(f"Stock dashboard: http://{args.host}:{args.port}")
    print(f"Symbols: {len(SYMBOLS)} | Cache: {CACHE_TTL_SECONDS}s")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
