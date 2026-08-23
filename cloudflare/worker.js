const DEFAULT_UPSTREAM_API_ORIGIN = "https://stocks.mastersgo.cc";
const QUOTE_CACHE_SECONDS = 60;
const POLICY_CACHE_SECONDS = 300;

const SECURITY_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
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
    dataFreshness: { state: rows.length ? "fresh" : "unavailable", sourceUpdatedAt: latest, staleAfterSeconds: 900 },
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

function upstreamOrigin(request, env) {
  const configured = String(env.UPSTREAM_API_ORIGIN || DEFAULT_UPSTREAM_API_ORIGIN).trim();
  const origin = new URL(configured);
  if (!/^https?:$/.test(origin.protocol)) throw new Error("UPSTREAM_API_ORIGIN must use http or https");
  if (origin.origin === new URL(request.url).origin) throw new Error("UPSTREAM_API_ORIGIN cannot point to this Worker");
  return origin;
}

async function proxyApi(request, env, cacheSeconds) {
  const incoming = new URL(request.url);
  const target = new URL(`${incoming.pathname}${incoming.search}`, upstreamOrigin(request, env));
  const force = incoming.searchParams.get("refresh") === "1";
  const response = await fetch(target, {
    headers: {
      Accept: "application/json",
      "User-Agent": "AIStockPoolCloudflare/1.0",
    },
    cf: force ? { cacheTtl: 0 } : { cacheEverything: true, cacheTtl: cacheSeconds },
  });
  if (!response.ok) throw new Error(`upstream ${incoming.pathname} returned ${response.status}`);
  return new Response(response.body, {
    status: response.status,
    headers: applyHeaders(response.headers, {
      "Cache-Control": force
        ? "no-store"
        : `public, max-age=0, s-maxage=${cacheSeconds}, stale-while-revalidate=${cacheSeconds * 5}`,
    }),
  });
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
      return await proxyApi(request, env, QUOTE_CACHE_SECONDS);
    } catch (error) {
      return quoteFallback(request, env, String(error));
    }
  }
  if (pathname === "/api/policy") {
    try {
      return await proxyApi(request, env, POLICY_CACHE_SECONDS);
    } catch (error) {
      return policyFallback(request, env, String(error));
    }
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
    if (request.method !== "GET") return jsonResponse({ error: "Method not allowed" }, 405);

    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) return handleApi(request, env);
    return env.ASSETS.fetch(request);
  },
};
