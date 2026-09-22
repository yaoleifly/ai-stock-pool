from __future__ import annotations

import json
import time
import unittest
from datetime import datetime, timedelta, timezone

from policy_engine import (
    apply_crowding_history,
    build_downgrade_lag,
    build_earnings_window,
    build_pressure_breakdown,
    build_scenario_matrix,
    classify_event_phase,
    compute_crowding_score,
    fill_missing_crowding_rows,
    parse_analyst_page,
    parse_expectation_trend,
)


class PolicyIntelligenceTests(unittest.TestCase):
    def test_parse_analyst_page_extracts_consensus_and_revisions(self) -> None:
        epoch = int(time.time())
        fixture = (
            'targetMeanPrice\\":{\\"raw\\":200.0,\\"fmt\\":\\"200.00\\"},'
            'recommendationMean\\":{\\"raw\\":1.5},'
            'recommendationKey\\":\\"strong_buy\\",'
            'numberOfAnalystOpinions\\":{\\"raw\\":20},'
            'recommendationTrend\\":{\\"trend\\":['
            '{\\"period\\":\\"0m\\",\\"strongBuy\\":8,\\"buy\\":9,\\"hold\\":3,\\"sell\\":0,\\"strongSell\\":0},'
            '{\\"period\\":\\"-3m\\",\\"strongBuy\\":7,\\"buy\\":9,\\"hold\\":4,\\"sell\\":0,\\"strongSell\\":0}]},'
            'upgradeDowngradeHistory\\":{\\"history\\":['
            f'{{\\"epochGradeDate\\":{epoch},\\"firm\\":\\"Example\\",\\"action\\":\\"main\\",'
            '\\"priceTargetAction\\":\\"Raises\\",\\"currentPriceTarget\\":200.0}]}'
        )
        parsed = parse_analyst_page(fixture)
        self.assertEqual(parsed["targetMean"], 200.0)
        self.assertEqual(parsed["analystCount"], 20)
        self.assertEqual(len(parsed["trend"]), 2)
        self.assertEqual(parsed["targetActions"]["raises"], 1)

    def test_crowding_requires_multiple_confirming_signals(self) -> None:
        analyst = {
            "targetMean": 150.0,
            "analystCount": 20,
            "trend": [
                {"period": "0m", "strongBuy": 8, "buy": 10, "hold": 2, "sell": 0, "strongSell": 0},
                {"period": "-3m", "strongBuy": 8, "buy": 9, "hold": 3, "sell": 0, "strongSell": 0},
            ],
            "targetActions": {"raises": 5, "cuts": 0},
        }
        result = compute_crowding_score(analyst, 100.0, -8.0, -12.0, -18.0)
        self.assertGreaterEqual(result["score"], 60)
        self.assertGreaterEqual(len(result["evidence"]), 2)
        self.assertIn(result["zone"], {"crowded", "distribution_risk"})

        price_still_strong = compute_crowding_score(analyst, 100.0, 8.0, 12.0, -4.0)
        self.assertNotEqual(price_still_strong["zone"], "distribution_risk")

    def test_deep_drawdown_with_sticky_consensus_is_distribution_risk(self) -> None:
        analyst = {
            "targetMean": 168.7,
            "analystCount": 43,
            "trend": [
                {"period": "0m", "strongBuy": 20, "buy": 18, "hold": 5, "sell": 0, "strongSell": 0},
                {"period": "-3m", "strongBuy": 19, "buy": 19, "hold": 5, "sell": 0, "strongSell": 0},
            ],
            "targetActions": {"raises": 21, "cuts": 0},
        }
        post_earnings_divergence = compute_crowding_score(
            analyst,
            current_price=100.0,
            return_5d=9.0,
            return_20d=-4.7,
            drawdown_3m=-26.3,
        )
        self.assertEqual(post_earnings_divergence["zone"], "distribution_risk")
        self.assertIn("股价走弱但评级尚未松动", post_earnings_divergence["evidence"])

        strong_price_confirmation = compute_crowding_score(
            analyst,
            current_price=100.0,
            return_5d=6.9,
            return_20d=7.0,
            drawdown_3m=-10.6,
        )
        self.assertNotEqual(strong_price_confirmation["zone"], "distribution_risk")

    def test_pressure_breakdown_and_scenario_are_independent(self) -> None:
        drivers = [
            {"id": "approval", "pressureScore": 80},
            {"id": "ust10y", "pressureScore": 60},
            {"id": "move", "pressureScore": 70},
            {"id": "spx", "pressureScore": 50},
            {"id": "vix", "pressureScore": 80},
            {"id": "inflation", "pressureScore": 55},
        ]
        breakdown = build_pressure_breakdown(drivers)
        self.assertEqual(len(breakdown), 4)
        matrix = build_scenario_matrix(65, 72)
        self.assertEqual(matrix["current"]["id"], "policy_high_crowding_high")

    def test_expectation_trend_exposes_eps_changes_without_faking_revenue_history(self) -> None:
        trend = {
            "trend": [
                {
                    "period": "0q",
                    "endDate": "2026-08-31",
                    "epsTrend": {
                        "current": {"raw": 4.0},
                        "30daysAgo": {"raw": 5.0},
                        "60daysAgo": {"raw": 8.0},
                    },
                    "revenueEstimate": {"avg": {"raw": 1_000_000_000}},
                }
            ]
        }
        escaped = json.dumps(trend, separators=(",", ":")).replace('"', '\\"')
        parsed = parse_expectation_trend(f'earningsTrend\\":{escaped}')
        primary = parsed["primary"]
        self.assertEqual(primary["eps"]["change30d"], -20.0)
        self.assertEqual(primary["eps"]["change60d"], -50.0)
        self.assertIsNone(primary["revenue"]["change30d"])
        self.assertEqual(primary["revenue"]["historyStatus"], "collecting")

    def test_event_window_separates_company_specific_return_from_sector(self) -> None:
        start = datetime(2026, 1, 1, tzinfo=timezone.utc)
        market_records = []
        sector_records = []
        for index in range(35):
            date = (start + timedelta(days=index)).date().isoformat()
            market_records.append({"date": date, "close": 100 if index <= 10 else 80, "volume": 300 if index == 11 else 100})
            sector_records.append({"date": date, "close": 100 if index <= 10 else 98, "volume": 100})
        result = build_earnings_window(
            {"records": market_records},
            {"records": sector_records},
            market_records[10]["date"],
        )
        self.assertLess(result["day20"]["excess"], -8)
        self.assertEqual(result["classification"], "company_specific_distribution")

    def test_downgrade_lag_detects_price_first_and_cut_later(self) -> None:
        start = datetime.now(timezone.utc) - timedelta(days=40)
        records = []
        for index in range(35):
            price = 100 if index < 10 else 80
            records.append({"date": (start + timedelta(days=index)).date().isoformat(), "close": price})
        break_date = records[10]["date"]
        cut_date = (datetime.fromisoformat(break_date) + timedelta(days=8)).replace(tzinfo=timezone.utc)
        result = build_downgrade_lag(
            {"records": records},
            [{"date": cut_date.isoformat(), "type": "target_cut"}],
        )
        self.assertEqual(result["status"], "cut_after_price")
        self.assertEqual(result["lagDays"], 8)

    def test_history_calculates_revenue_revision_and_risk_change(self) -> None:
        now = datetime.now(timezone.utc).date()
        history = {
            "snapshots": [
                {
                    "date": (now - timedelta(days=35)).isoformat(),
                    "rows": [{"ticker": "MU", "score": 70, "revenueEstimate": 110}],
                },
                {
                    "date": (now - timedelta(days=8)).isoformat(),
                    "rows": [{"ticker": "MU", "score": 75, "revenueEstimate": 105}],
                },
            ]
        }
        row = {
            "ticker": "MU",
            "score": 82,
            "evidence": [],
            "metrics": {"targetRaises45d": 5, "targetCuts45d": 0, "epsChange30d": -3, "epsChange60d": -5},
            "expectations": {"primary": {"revenue": {"current": 100}}},
        }
        decorated = apply_crowding_history(row, history)
        self.assertEqual(decorated["metrics"]["revenueChange30d"], -9.1)
        self.assertEqual(decorated["scoreChange7d"], 7)
        self.assertEqual(decorated["expectationDivergence"]["status"], "warning")

    def test_history_snapshot_fills_missing_crowding_watchlist_row(self) -> None:
        history = {
            "snapshots": [
                {
                    "date": "2026-08-22",
                    "asOf": "2026-08-22T05:43:02+00:00",
                    "rows": [
                        {"ticker": "AMD", "score": 68, "zone": "crowded"},
                        {"ticker": "AVGO", "score": 72, "zone": "crowded"},
                        {"ticker": "MRVL", "score": 59, "zone": "watch"},
                        {"ticker": "MU", "score": 71, "zone": "crowded"},
                        {"ticker": "NVDA", "score": 77, "zone": "crowded"},
                        {
                            "ticker": "SMCI",
                            "score": 29,
                            "zone": "balanced",
                            "currentPrice": 37.24,
                            "targetMean": 42.38,
                            "targetMedian": 42.5,
                            "bullishShare": 26.3,
                            "epsEstimate": 1.03,
                            "revenueEstimate": 14_971_092_730,
                            "targetRaises45d": 0,
                            "targetCuts45d": 0,
                        },
                    ],
                }
            ]
        }
        rows = [{"ticker": "AMD", "score": 68}]
        filled = fill_missing_crowding_rows(rows, {"SMCI": "analyst unavailable"}, history)
        tickers = {row["ticker"] for row in filled}
        self.assertIn("SMCI", tickers)
        fallback = next(row for row in filled if row["ticker"] == "SMCI")
        self.assertEqual(fallback["fallback"]["status"], "snapshot")
        self.assertEqual(fallback["metrics"]["targetMean"], 42.38)

    def test_event_phase_classification(self) -> None:
        self.assertEqual(classify_event_phase("Tariffs delayed as talks resume"), "softening")
        self.assertEqual(classify_event_phase("New sanctions imposed after threat"), "escalation")
        self.assertEqual(classify_event_phase("Final rule takes effect today"), "execution")


if __name__ == "__main__":
    unittest.main()
