import { getQuotes } from "./quotes.js";
import { mobileFeed, mobileAnalyze } from "./mobile.js";

const QUOTE_CACHE_SECONDS = 60;
const POLICY_CACHE_SECONDS = 300;

const SECURITY_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Content-Type-Options": "nosniff",
};

function applyHeaders(headers, extra = {}) {
  const output = new Headers(headers);
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) output.set(key, value);
  for (const [key, value] of Object.entries(extra)) output.set(key, value);
  output.delete("set-cookie");
  return output;
}

function jsonResponse(payload, status = 200, cacheControl = "no-store") {
  return new Response(JSON.stringify(payload), {
    status,
    headers: applyHeaders(
      { "Content-Type": "application/json; charset=utf-8" },
      { "Cache-Control": cacheControl },
    ),
  });
}

export function parseCsvRows(text) {
  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      row.push(value);
      value = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      row.push(value);
      value = "";
      if (row.some((cell) => cell.length)) rows.push(row);
      row = [];
    } else {
      value += character;
    }
  }

  if (value.length || row.length) {
    row.push(value);
    if (row.some((cell) => cell.length)) rows.push(row);
  }
  if (!rows.length) return [];

  const headers = rows[0].map((header) => header.replace(/^\uFEFF/, "").trim());
  return rows.slice(1).map((cells) => Object.fromEntries(headers.map((header, index) => [header, cells[index] || ""])));
}

export function buildHealthPayload(poolRows) {
  const rows = poolRows.filter((row) => row.ticker);
  const markets = {};
  for (const row of rows) {
    const market = row.market || "美股";
    markets[market] = (markets[market] || 0) + 1;
  }
  return {
    ok: true,
    runtime: "cloudflare-workers",
    symbols: rows.length,
    markets,
    cacheSeconds: QUOTE_CACHE_SECONDS,
    policyEndpoint: "/api/policy",
  };
}

async function loadPool(request, env) {
  const assetUrl = new URL("/stock-pool.csv", request.url);
  const response = await env.ASSETS.fetch(new Request(assetUrl));
  if (!response.ok) throw new Error(`stock-pool.csv unavailable (${response.status})`);
  return parseCsvRows(await response.text());
}

async function loadDiscoverySignals(request, env) {
  const assetUrl = new URL("/discovery-signals.csv", request.url);
  const response = await env.ASSETS.fetch(new Request(assetUrl));
  if (!response.ok) throw new Error(`discovery-signals.csv unavailable (${response.status})`);
  return parseCsvRows(await response.text());
}

function mobileReferenceTickers(searchParams) {
  return new Set(
    String(searchParams.get("reference_ids") || "")
      .split(",")
      .map((value) => value.trim())
      .filter((value) => value.startsWith("ticker:"))
      .map((value) => value.slice("ticker:".length).trim().toUpperCase())
      .filter((value) => value && value.length <= 24),
  );
}

function mobileLimit(value) {
  const parsed = Number.parseInt(value || "6", 10);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(parsed, 20)) : 6;
}

export function buildMobileBriefing(signalRows, poolRows, searchParams, now = new Date()) {
  const references = mobileReferenceTickers(searchParams);
  const companyNames = new Map(poolRows.filter((row) => row.ticker).map((row) => [row.ticker.trim().toUpperCase(), row.company || row.ticker]));
  const parseTickers = (value) => String(value || "").split(";").map((ticker) => ticker.trim().toUpperCase()).filter(Boolean);
  const rows = signalRows
    .filter((row) => row.signal_id && row.title)
    .filter((row) => !references.size || parseTickers(row.mapped_tickers).some((ticker) => references.has(ticker)))
    .sort((left, right) => String(right.created_at || right.date).localeCompare(String(left.created_at || left.date)))
    .slice(0, mobileLimit(searchParams.get("limit")));
  const latest = rows.map((row) => row.created_at || row.date).filter(Boolean).sort().at(-1) || null;
  return {
    schemaVersion: "1.0",
    generatedAt: now.toISOString(),
    dataFreshness: { state: !rows.length ? "unavailable" : !latest || now.getTime() - Date.parse(latest) > 900000 ? "stale" : "fresh", sourceUpdatedAt: latest, staleAfterSeconds: 900 },
    data: {
      matchMode: references.size ? "reference_tickers" : "latest_public_signals",
      requestedReferences: [...references].sort().map((ticker) => `ticker:${ticker}`),
      items: rows.map((row) => {
        const mapped = parseTickers(row.mapped_tickers);
        const related = references.size ? mapped.filter((ticker) => references.has(ticker)) : mapped;
        return {
          id: `signal:${row.signal_id}`,
          kind: "discovery_signal",
          title: row.title,
          summary: row.summary || "该信号尚未形成可展示摘要。",
          occurredAt: row.date || row.created_at || null,
          relevance: "possible",
          referenceObjects: related.slice(0, 12).map((ticker) => ({ id: `ticker:${ticker}`, type: "ticker", displayName: companyNames.get(ticker) || ticker })),
          source: { title: row.source_name || "未知来源", url: row.source_url || null, publishedAt: row.date || null },
          disclaimer: "这是公共研究线索，需由用户确认后才能加入个人研究，不构成投资建议。",
        };
      }),
    },
  };
}

async function policyFallback(request, env, reason) {
  const assetUrl = new URL("/tpi-latest.json", request.url);
  const response = await env.ASSETS.fetch(new Request(assetUrl));
  if (!response.ok) {
    return jsonResponse({ status: "error", error: "政策压力数据暂时不可用", detail: reason }, 502);
  }
  const payload = await response.json();
  return jsonResponse(
    { ...payload, status: "fallback", warning: reason },
    200,
    `public, max-age=0, s-maxage=${POLICY_CACHE_SECONDS}`,
  );
}

async function quoteFallback(request, env, reason) {
  const rows = await loadPool(request, env);
  const health = buildHealthPayload(rows);
  return jsonResponse({
    asOf: new Date().toISOString(),
    source: "static fallback",
    refreshSeconds: QUOTE_CACHE_SECONDS,
    requested: health.symbols,
    received: 0,
    markets: health.markets,
    missing: rows.map((row) => row.ticker).filter(Boolean).sort(),
    quotes: {},
    stale: true,
    warning: reason,
  });
}

async function handleApi(request, env) {
  const { pathname } = new URL(request.url);
  if (pathname === "/api/health") {
    try {
      return jsonResponse(buildHealthPayload(await loadPool(request, env)));
    } catch (error) {
      return jsonResponse({ ok: false, error: String(error) }, 500);
    }
  }
  if (pathname === "/api/quotes") {
    try {
      return jsonResponse(await getQuotes(await loadPool(request, env), request));
    } catch (error) {
      return quoteFallback(request, env, String(error));
    }
  }
  if (pathname === "/api/policy") {
    try {
      const response = await fetch('https://raw.githubusercontent.com/yaoleifly/ai-stock-pool/main/tpi-latest.json', { signal: AbortSignal.timeout(8000), cf: { cacheTtl: 300, cacheEverything: true } });
      if (!response.ok) throw new Error('Policy snapshot unavailable');
      let payload = await response.json();
      const bundled = await env.ASSETS.fetch(new Request(new URL('/tpi-latest.json', request.url)));
      if (bundled.ok) {
        const snapshot = await bundled.json();
        if (Date.parse(snapshot.asOf) > Date.parse(payload.asOf || 0)) payload = snapshot;
      }
      if (!payload.index || !Array.isArray(payload.drivers)) throw new Error('Invalid policy snapshot');
      const age = Date.now() - Date.parse(payload.asOf || '');
      return jsonResponse({ ...payload, status: 'scheduled_snapshot', stale: !Number.isFinite(age) || age > 3*3600000, warning: age > 3*3600000 ? '政策快照超过三小时未更新' : null, method: { ...payload.method, marketRefresh: '定时快照，计划每小时更新；更新时间以数据源为准' } });
    } catch (error) {
      return policyFallback(request, env, String(error));
    }
  }
  if (pathname === "/api/mobile/feed") {
    try { return jsonResponse(await mobileFeed(), 200, 'public, max-age=0, s-maxage=600'); }
    catch { return jsonResponse({ error: 'Feed unavailable', items: [] }, 503); }
  }
  if (pathname === "/api/mobile/briefing") {
    try {
      const [signals, poolRows] = await Promise.all([loadDiscoverySignals(request, env), loadPool(request, env)]);
      return jsonResponse(buildMobileBriefing(signals, poolRows, new URL(request.url).searchParams), 200, "public, max-age=0, s-maxage=900, stale-while-revalidate=1800");
    } catch (error) {
      return jsonResponse({ schemaVersion: "1.0", error: { code: "DATA_UNAVAILABLE", message: "主动发现数据暂时不可用", retryable: true } }, 503);
    }
  }
  return jsonResponse({ error: "Not found" }, 404);
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: applyHeaders({}) });
    }
    if (new URL(request.url).pathname === '/api/mobile/analyze' && request.method === 'POST') {
      try { return await mobileAnalyze(request, env); } catch { return jsonResponse({error:{code:'AI_UNAVAILABLE',message:'AI 分析暂时不可用，请稍后重试。'}},502); }
    }
    if (request.method !== "GET") return jsonResponse({ error: "Method not allowed" }, 405);

    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) return handleApi(request, env);
    return env.ASSETS.fetch(request);
  },
};
