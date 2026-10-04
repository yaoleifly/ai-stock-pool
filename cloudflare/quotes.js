export function providerSymbol(ticker) {
  if (/^\d{6}\.BJ$/.test(ticker)) return `bj${ticker.slice(0, 6)}`;
  if (/^\d{6}\.SS$/.test(ticker)) return `sh${ticker.slice(0, 6)}`;
  if (/^\d{6}\.SZ$/.test(ticker)) return `sz${ticker.slice(0, 6)}`;
  if (/^[A-Z][A-Z0-9.-]{0,15}$/.test(ticker)) return `us${ticker.replaceAll('.', '/')}`;
  return null;
}
const number = value => value !== '' && value != null && Number.isFinite(Number(value)) ? Number(value) : null;
function quoteTime(value, market) {
  const parts = value?.match(/\d+/g);
  let iso;
  if (/^\d{14}$/.test(value)) iso = `${value.slice(0,4)}-${value.slice(4,6)}-${value.slice(6,8)}T${value.slice(8,10)}:${value.slice(10,12)}:${value.slice(12,14)}+08:00`;
  else if (parts?.length === 6) {
    const base = `${parts[0]}-${parts[1]}-${parts[2]}T${parts[3]}:${parts[4]}:${parts[5]}`;
    const offset = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', timeZoneName: 'shortOffset' }).formatToParts(new Date(base + 'Z')).find(p => p.type === 'timeZoneName').value;
    iso = base + (offset === 'GMT-4' ? '-04:00' : '-05:00');
  }
  return iso && Number.isFinite(Date.parse(iso)) ? new Date(iso).toISOString() : null;
}
export function parseQuotes(text, rows) {
  const values = new Map([...text.matchAll(/v_([^=]+)="([^"]*)";/g)].map(m => [m[1], m[2].split('~')]));
  const quotes = {};
  for (const row of rows) {
    const ticker = row.ticker.trim().toUpperCase(), key = providerSymbol(ticker), fields = values.get(key);
    if (!fields || fields.length < 35) continue;
    const price = number(fields[3]), timestamp = quoteTime(fields[30], row.market);
    if (!(price > 0) || !timestamp) continue;
    const previousClose = number(fields[4]), volume = number(fields[6]);
    quotes[ticker] = { price, previousClose, change: number(fields[31]), changePercent: number(fields[32]), dayHigh: number(fields[33]), dayLow: number(fields[34]), volume: volume == null ? null : volume * (key.startsWith('us') ? 1 : 100), currency: row.market === 'A股' ? 'CNY' : 'USD', market: row.market || '美股', timestamp };
  }
  return quotes;
}
let memo, pending;
export async function getQuotes(rows, request) {
  const force = new URL(request.url).searchParams.get('refresh') === '1';
  if (memo && Date.now() - memo.time < (force ? 10000 : 60000)) return memo.payload;
  if (pending) return pending;
  pending = (async () => {
    const groups = [];
    for (let i = 0; i < rows.length; i += 50) groups.push(rows.slice(i, i + 50));
    const results = await Promise.allSettled(groups.map(async group => {
      const symbols = group.map(r => providerSymbol(r.ticker.trim().toUpperCase())).filter(Boolean);
      const response = await fetch(`https://qt.gtimg.cn/q=${symbols.join(',')}`, { headers: { Referer: 'https://gu.qq.com/' }, signal: AbortSignal.timeout(12000), cf: { cacheTtl: 60, cacheEverything: true } });
      if (!response.ok) throw new Error('Quote provider unavailable');
      // Only ASCII numeric fields are consumed; provider company names are ignored.
      return parseQuotes(await response.text(), group);
    }));
    const quotes = Object.assign({}, ...results.filter(r => r.status === 'fulfilled').map(r => r.value));
    if (!Object.keys(quotes).length && memo) return { ...memo.payload, stale: true, warning: '行情来源暂不可用，显示上次缓存。' };
    if (!Object.keys(quotes).length) throw new Error('No quotes available');
    const markets = {}; for (const r of rows) markets[r.market || '美股'] = (markets[r.market || '美股'] || 0) + 1;
    const missing = rows.map(r => r.ticker).filter(t => !quotes[t]);
    const payload = { asOf: new Date().toISOString(), source: 'Tencent Finance (delayed exchange quotes)', refreshSeconds: 60, requested: rows.length, received: Object.keys(quotes).length, markets, quotes, missing, stale: false, ...(missing.length ? { warning: `${missing.length} 个标的暂无行情` } : {}) };
    memo = { time: Date.now(), payload }; return payload;
  })();
  try { return await pending; } finally { pending = null; }
}
