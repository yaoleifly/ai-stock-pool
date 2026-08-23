"""Read-only mobile briefing adapter for AI stock-pool generated data."""

from __future__ import annotations

import csv
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable

DEFAULT_LIMIT = 6
MAX_LIMIT = 20


def parse_reference_ids(value: str | None) -> set[str]:
    """Normalize comma-separated ticker:<symbol> reference ids."""
    if not value:
        return set()
    symbols: set[str] = set()
    for raw in value.split(","):
        reference = raw.strip()
        if reference.startswith("ticker:"):
            symbol = reference.removeprefix("ticker:").strip().upper()
            if symbol and len(symbol) <= 24:
                symbols.add(symbol)
    return symbols


def clamp_limit(value: str | None) -> int:
    try:
        return max(1, min(int(value or DEFAULT_LIMIT), MAX_LIMIT))
    except ValueError:
        return DEFAULT_LIMIT


def load_csv(path: Path) -> list[dict[str, str]]:
    if not path.exists():
        return []
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        return [dict(row) for row in csv.DictReader(handle) if row]


def normalize_tickers(value: str | None) -> list[str]:
    return [part.strip().upper() for part in (value or "").split(";") if part.strip()]


def parse_timestamp(value: str | None) -> datetime:
    if not value:
        return datetime.min.replace(tzinfo=timezone.utc)
    try:
        timestamp = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
    except ValueError:
        try:
            timestamp = datetime.strptime(value.strip(), "%Y-%m-%d").replace(tzinfo=timezone.utc)
        except ValueError:
            return datetime.min.replace(tzinfo=timezone.utc)
    return timestamp if timestamp.tzinfo else timestamp.replace(tzinfo=timezone.utc)


def format_timestamp(value: str | None) -> str | None:
    timestamp = parse_timestamp(value)
    if timestamp == datetime.min.replace(tzinfo=timezone.utc):
        return None
    return timestamp.astimezone(timezone.utc).isoformat()


def build_briefing(
    signal_rows: Iterable[dict[str, str]],
    pool_rows: Iterable[dict[str, str]],
    reference_tickers: set[str],
    limit: int = DEFAULT_LIMIT,
    generated_at: datetime | None = None,
) -> dict[str, object]:
    """Return a mobile contract without modifying generated sources or the formal pool."""
    generated_at = generated_at or datetime.now(timezone.utc)
    company_names = {
        row.get("ticker", "").strip().upper(): (row.get("company", "").strip() or row.get("ticker", "").strip().upper())
        for row in pool_rows
        if row.get("ticker")
    }

    matching: list[dict[str, str]] = []
    for row in signal_rows:
        mapped_tickers = set(normalize_tickers(row.get("mapped_tickers")))
        if reference_tickers and not mapped_tickers.intersection(reference_tickers):
            continue
        if row.get("signal_id") and row.get("title"):
            matching.append(row)

    matching.sort(
        key=lambda row: (
            parse_timestamp(row.get("date") or row.get("created_at")),
            int(row.get("evidence_strength") or 0),
            int(row.get("confidence") or 0),
        ),
        reverse=True,
    )
    selected = matching[:limit]
    latest = max((parse_timestamp(row.get("created_at") or row.get("date")) for row in selected), default=None)

    def item(row: dict[str, str]) -> dict[str, object]:
        mapped = normalize_tickers(row.get("mapped_tickers"))
        related = mapped if not reference_tickers else [ticker for ticker in mapped if ticker in reference_tickers]
        return {
            "id": f"signal:{row['signal_id']}",
            "kind": "discovery_signal",
            "title": row["title"],
            "summary": row.get("summary") or "该信号尚未形成可展示摘要。",
            "occurredAt": format_timestamp(row.get("date") or row.get("created_at")),
            "relevance": "possible",
            "referenceObjects": [
                {"id": f"ticker:{ticker}", "type": "ticker", "displayName": company_names.get(ticker, ticker)}
                for ticker in related[:12]
            ],
            "source": {
                "title": row.get("source_name") or "未知来源",
                "url": row.get("source_url") or None,
                "publishedAt": format_timestamp(row.get("date")),
            },
            "disclaimer": "这是公共研究线索，需由用户确认后才能加入个人研究，不构成投资建议。",
        }

    return {
        "schemaVersion": "1.0",
        "generatedAt": generated_at.astimezone(timezone.utc).isoformat(),
        "dataFreshness": {
            "state": "fresh" if selected else "unavailable",
            "sourceUpdatedAt": latest.astimezone(timezone.utc).isoformat() if latest else None,
            "staleAfterSeconds": 900,
        },
        "data": {
            "matchMode": "reference_tickers" if reference_tickers else "latest_public_signals",
            "requestedReferences": [f"ticker:{ticker}" for ticker in sorted(reference_tickers)],
            "items": [item(row) for row in selected],
        },
    }
