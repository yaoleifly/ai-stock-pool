const PREVIEW_WORKBENCH = 'https://super-digger-linked-preview.mastergo.workers.dev';
const WORKBENCH = 'https://mastersgo.cc';
export function workbenchOrigin(preview) { return preview ? PREVIEW_WORKBENCH : WORKBENCH; }
export function makeResearchUrl(stock, preview, includeQuestion = true) {
  const context = { ticker: stock.ticker, company: String(stock.company || '').slice(0,160), theme: String(stock.category || '').slice(0,160), question: includeQuestion ? String(stock.key_focus || '核对增长动力、订单与主要风险').slice(0,2000) : '核对增长动力、订单与主要风险', preview };
  return `${workbenchOrigin(preview)}/#/?stock=${encodeURIComponent(JSON.stringify(context))}`;
}
export function parseResearchReturn(hash) {
  try {
    if (!hash.startsWith('#research=') || hash.length > 1500) return null;
    const data = JSON.parse(decodeURIComponent(hash.slice(10)));
    if (!data || typeof data.ticker !== 'string' || !/^[A-Za-z0-9.^=-]{1,24}$/.test(data.ticker)) return null;
    if (data.reportId !== undefined && (!Number.isSafeInteger(data.reportId) || data.reportId <= 0 || typeof data.preview !== 'boolean')) return null;
    return { ticker: data.ticker, ...(data.reportId ? { reportId: data.reportId, preview: data.preview } : {}) };
  } catch { return null; }
}
export function reportUrl(entry) { return `${workbenchOrigin(entry.preview)}/#/?report=${entry.reportId}`; }
export function readLinks(storage) {
  try {
    const data = JSON.parse(storage.getItem('mastersgo-report-links-v1') || '[]');
    return Array.isArray(data) ? data.filter(x => x && parseResearchReturn('#research=' + encodeURIComponent(JSON.stringify(x)))?.reportId).slice(0,100) : [];
  } catch { return []; }
}
export function saveLink(storage, entry) {
  const next = [entry, ...readLinks(storage).filter(x => x.reportId !== entry.reportId || x.preview !== entry.preview)].slice(0,100);
  try { storage.setItem('mastersgo-report-links-v1', JSON.stringify(next)); return true; } catch { return false; }
}
