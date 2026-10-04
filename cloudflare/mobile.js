const SYSTEM_PROMPT = "你是 Findness（GeminiStocks 的 iOS 版）的投资挖掘助手。用中文输出 JSON，字段必须为 investmentScore、informationGapScore、conclusion、upsideCase、riskCases、whatHappened、impactPath、supportingEvidence、uncertainties、nextChecks、disclaimer。investmentScore 和 informationGapScore 为 0-100 整数；其余字段除 disclaimer 外均为字符串数组；conclusion 只能有一项。投资吸引力衡量继续研究价值，信息差衡量市场可能尚未充分消化的程度，不代表收益预测。严格区分事实、推断和待确认内容；不提供买卖建议，不编造实时数据或来源。";
import { XMLParser } from 'fast-xml-parser';
const sources = [['雪球', 'https://xueqiu.com/hots/topic/rss'], ['虎嗅', 'https://rss.huxiu.com'], ['彭博', 'https://bbg.buzzing.cc/feed.xml']];
const plain = v => String(typeof v === 'object' ? v?.['#text'] || '' : v || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
export async function mobileFeed() {
  const settled = await Promise.allSettled(sources.map(async ([name, url]) => {
    const r = await fetch(url, { signal: AbortSignal.timeout(12000), cf: { cacheTtl: 600, cacheEverything: true } });
    if (!r.ok) throw new Error('Feed unavailable');
    const data = new XMLParser({ ignoreAttributes: false, processEntities: false }).parse(await r.text());
    const rows = data.rss?.channel?.item || data.feed?.entry || [];
    return (Array.isArray(rows) ? rows : [rows]).slice(0,8).map(a => {
      const links = Array.isArray(a.link) ? a.link : [a.link];
      const link = links.map(v => typeof v === 'object' ? v?.['@_href'] : v).find(v => /^https?:\/\//.test(v || ''));
      return { id: `${name}:${link}`, title: plain(a.title), summary: plain(a.description || a.summary || a.content).slice(0,280), url: link, source: name };
    }).filter(a => a.title && a.url);
  }));
  const lists = settled.filter(r => r.status === 'fulfilled').map(r => r.value), items = [], seen = new Set();
  for (let i=0;i<8;i++) for (const list of lists) if(list[i] && !seen.has(list[i].url)) { seen.add(list[i].url); items.push(list[i]); }
  return { generatedAt: new Date().toISOString(), items: items.slice(0,15) };
}
export async function mobileAnalyze(request, env) {
  if (!env.DEEPSEEK_API_KEY) return Response.json({ error: { code: 'AI_NOT_CONFIGURED', message: 'AI 服务暂未配置。' } }, { status: 503 });
  if (Number(request.headers.get('content-length') || 0) > 20000) return Response.json({ error: { code:'INVALID_REQUEST', message:'请求过大。' } }, {status:413});
  let body; try { body = await request.json(); } catch { return Response.json({error:{code:'INVALID_REQUEST',message:'请输入想研究的内容。'}},{status:400}); }
  const input = typeof body.input === 'string' ? body.input.trim() : '';
  if (input.length < 2 || input.length > 4000) return Response.json({error:{code:'INVALID_INPUT',message:'研究内容请保持在 2 到 4000 个字符内。'}},{status:400});
  const response = await fetch('https://api.deepseek.com/chat/completions', { method:'POST', headers:{Authorization:`Bearer ${env.DEEPSEEK_API_KEY}`,'Content-Type':'application/json'}, signal:AbortSignal.timeout(55000), body:JSON.stringify({model:env.DEEPSEEK_MODEL || 'deepseek-v4-flash',response_format:{type:'json_object'},messages:[{role:'system',content:SYSTEM_PROMPT},{role:'user',content:input}],temperature:.3,max_tokens:1800}) });
  if (!response.ok) return Response.json({error:{code:'AI_UNAVAILABLE',message:'AI 分析暂时不可用，请稍后重试。'}},{status:502});
  const data = await response.json(), report = JSON.parse(data.choices[0].message.content);
  for (const key of ['conclusion','upsideCase','riskCases','whatHappened','impactPath','supportingEvidence','uncertainties','nextChecks']) report[key] = Array.isArray(report[key]) ? report[key] : [String(report[key] || '')];
  for (const key of ['investmentScore','informationGapScore']) report[key] = Number.isFinite(Number(report[key])) ? Math.max(0,Math.min(100,Math.trunc(Number(report[key])))) : 50;
  report.disclaimer = String(report.disclaimer || '本分析仅供研究参考，不构成投资建议。');
  return Response.json({ schemaVersion:'1.0',input,report },{headers:{'Cache-Control':'no-store'}});
}
