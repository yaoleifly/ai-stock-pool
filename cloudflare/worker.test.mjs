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

import { parseQuotes, providerSymbol } from './quotes.js';
import worker from './worker.js';
test('quote symbols remain fixed to the configured stock pool', () => {
  assert.equal(providerSymbol('600519.SS'), 'sh600519');
  assert.equal(providerSymbol('000001.SZ'), 'sz000001');
  assert.equal(providerSymbol('NVDA'), 'usNVDA');
  assert.equal(providerSymbol('920808.BJ'), 'bj920808');
  assert.equal(providerSymbol('bad&symbol'), null);
});
test('batch quotes preserve units, timestamp and missing symbols', () => {
  const f = Array(36).fill(''); f[3]='12'; f[4]='10'; f[6]='100'; f[30]='20260930150000'; f[31]='2'; f[32]='20'; f[33]='13'; f[34]='9';
  const result = parseQuotes(`v_sh600519="${f.join('~')}";`, [{ticker:'600519.SS',market:'A股'},{ticker:'NVDA',market:'美股'}]);
  assert.equal(result['600519.SS'].volume,10000);
  assert.equal(result['600519.SS'].timestamp,'2026-09-30T07:00:00.000Z');
  assert.equal(result['600519.SS'].changePercent,20);
  assert.equal(result.NVDA,undefined);
});
test('old discovery articles are not presented as fresh', () => {
  const payload=buildMobileBriefing([{signal_id:'x',title:'Old',date:'2020-01-01'}],[],new URLSearchParams(),new Date('2026-10-04'));
  assert.equal(payload.dataFreshness.state,'stale');
});
test('mobile AI remains explicitly unavailable without a configured secret', async () => {
  const response=await worker.fetch(new Request('https://stocks.mastersgo.cc/api/mobile/analyze',{method:'POST',body:'{"input":"NVDA"}'}),{});
  assert.equal(response.status,503);
  assert.equal((await response.json()).error.code,'AI_NOT_CONFIGURED');
});
