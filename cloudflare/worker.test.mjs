import assert from "node:assert/strict";
import test from "node:test";

import { buildHealthPayload, buildMobileBriefing, parseCsvRows } from "./worker.js";

test("parseCsvRows handles quoted commas and escaped quotes", () => {
  const rows = parseCsvRows('ticker,company,market\nNVDA,"NVIDIA, Inc.",美股\n000001.SZ,"平安""银行",A股\n');
  assert.deepEqual(rows, [
    { ticker: "NVDA", company: "NVIDIA, Inc.", market: "美股" },
    { ticker: "000001.SZ", company: '平安"银行', market: "A股" },
  ]);
});

test("buildHealthPayload counts the deploy snapshot", () => {
  const payload = buildHealthPayload([
    { ticker: "NVDA", market: "美股" },
    { ticker: "INTC", market: "美股" },
    { ticker: "000001.SZ", market: "A股" },
  ]);
  assert.equal(payload.ok, true);
  assert.equal(payload.runtime, "cloudflare-workers");
  assert.equal(payload.symbols, 3);
  assert.deepEqual(payload.markets, { 美股: 2, A股: 1 });
});

test("buildMobileBriefing filters by linked tickers and preserves source metadata", () => {
  const signals = [
    { signal_id: "new", date: "2026-08-23", created_at: "2026-08-23T10:00:00Z", title: "Packaging signal", summary: "Capacity watch", source_name: "Official", source_url: "https://example.com", mapped_tickers: "NVDA; TSM" },
    { signal_id: "other", date: "2026-08-22", title: "Other signal", source_name: "News", mapped_tickers: "AMD" },
  ];
  const payload = buildMobileBriefing(signals, [{ ticker: "NVDA", company: "NVIDIA" }], new URLSearchParams("reference_ids=ticker:NVDA&limit=3"), new Date("2026-08-23T12:00:00Z"));
  assert.equal(payload.data.matchMode, "reference_tickers");
  assert.equal(payload.data.items.length, 1);
  assert.deepEqual(payload.data.items[0].referenceObjects, [{ id: "ticker:NVDA", type: "ticker", displayName: "NVIDIA" }]);
  assert.equal(payload.data.items[0].source.title, "Official");
});
