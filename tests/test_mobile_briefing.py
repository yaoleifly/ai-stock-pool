from __future__ import annotations

from datetime import datetime, timezone
import unittest

from mobile_briefing import build_briefing, clamp_limit, parse_reference_ids


class MobileBriefingTests(unittest.TestCase):
    def setUp(self) -> None:
        self.pool = [{"ticker": "NVDA", "company": "NVIDIA"}, {"ticker": "TSM", "company": "Taiwan Semiconductor Manufacturing"}]
        self.signals = [
            {"signal_id": "newer", "date": "2026-08-23", "created_at": "2026-08-23T10:00:00+00:00", "title": "Advanced packaging signal", "summary": "Packaging capacity is being watched.", "source_name": "Official release", "source_url": "https://example.com/newer", "mapped_tickers": "NVDA; TSM", "evidence_strength": "80", "confidence": "90"},
            {"signal_id": "other", "date": "2026-08-22", "created_at": "2026-08-22T10:00:00+00:00", "title": "Unrelated signal", "summary": "Other chain.", "source_name": "News", "mapped_tickers": "AMD", "evidence_strength": "90", "confidence": "90"},
        ]

    def test_reference_filter_keeps_only_matching_signal_and_maps_company_name(self) -> None:
        payload = build_briefing(self.signals, self.pool, {"NVDA"}, generated_at=datetime(2026, 8, 23, tzinfo=timezone.utc))
        self.assertEqual(payload["data"]["matchMode"], "reference_tickers")
        items = payload["data"]["items"]
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]["id"], "signal:newer")
        self.assertEqual(items[0]["referenceObjects"], [{"id": "ticker:NVDA", "type": "ticker", "displayName": "NVIDIA"}])

    def test_no_match_returns_explicit_unavailable_state(self) -> None:
        payload = build_briefing(self.signals, self.pool, {"SMCI"})
        self.assertEqual(payload["dataFreshness"]["state"], "unavailable")
        self.assertEqual(payload["data"]["items"], [])

    def test_parse_and_clamp_query_values(self) -> None:
        self.assertEqual(parse_reference_ids("ticker:nvda,theme:ai,ticker: TSM"), {"NVDA", "TSM"})
        self.assertEqual(clamp_limit("99"), 20)
        self.assertEqual(clamp_limit("nope"), 6)


if __name__ == "__main__":
    unittest.main()
