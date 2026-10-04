import csv
import json
import os
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

import discovery_engine


class DiscoveryEngineDateTests(unittest.TestCase):
    def test_report_date_uses_asia_shanghai_day_boundary(self):
        utc_time = datetime(2026, 8, 6, 16, 30, tzinfo=timezone.utc)
        with patch.object(discovery_engine, "now_utc", return_value=utc_time):
            with patch.dict(os.environ, {}, clear=False):
                os.environ.pop("DISCOVERY_TIMEZONE", None)
                self.assertEqual(discovery_engine.report_today(), "2026-08-07")

    def test_empty_refresh_is_rejected_by_safety_gate(self):
        self.assertFalse(discovery_engine.discovery_result_is_valid([], []))
        self.assertFalse(discovery_engine.discovery_result_is_valid([object()], []))
        self.assertTrue(discovery_engine.discovery_result_is_valid([object()], [{"ticker": "NVDA"}]))

    def test_latest_discovery_date_prefers_candidate_run_date(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            candidates = root / "discovery-candidates.csv"
            signals = root / "discovery-signals.csv"
            papers = root / "arxiv-papers.csv"
            with candidates.open("w", encoding="utf-8", newline="") as handle:
                writer = csv.DictWriter(handle, fieldnames=["run_date", "ticker"])
                writer.writeheader()
                writer.writerow({"run_date": "2026-09-04", "ticker": "NVDA"})
            signals.write_text("date,signal_id\n2026-09-15,new\n", encoding="utf-8")
            papers.write_text("published,arxiv_id\n2026-09-14,2609.1\n", encoding="utf-8")
            with (
                patch.object(discovery_engine, "CANDIDATES_FILE", candidates),
                patch.object(discovery_engine, "SIGNALS_FILE", signals),
                patch.object(discovery_engine, "PAPERS_FILE", papers),
            ):
                self.assertEqual(discovery_engine.latest_discovery_date(), "2026-09-04")

    def test_failure_status_records_attempt_without_advancing_data_date(self):
        with tempfile.TemporaryDirectory() as directory:
            status_path = Path(directory) / "discovery-status.json"
            with patch.object(discovery_engine, "STATUS_FILE", status_path):
                discovery_engine.write_discovery_status(
                    status="failed",
                    attempted_at="2026-09-16T09:00:00+00:00",
                    attempted_date="2026-09-16",
                    data_date="2026-09-04",
                    signals=0,
                    papers=0,
                    candidates=0,
                    warnings=["network unavailable"],
                    message="kept previous data",
                )
            payload = json.loads(status_path.read_text(encoding="utf-8"))
            self.assertEqual(payload["status"], "failed")
            self.assertEqual(payload["attemptedDate"], "2026-09-16")
            self.assertEqual(payload["dataDate"], "2026-09-04")


if __name__ == "__main__":
    unittest.main()
