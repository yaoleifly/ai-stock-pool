import { workbenchOrigin, makeResearchUrl, parseResearchReturn, reportUrl, readLinks, saveLink } from './research-bridge.js';
const linkStorage = { getItem: key => window.localStorage.getItem(key), setItem: (key, value) => window.localStorage.setItem(key, value) };
const isDesignPreview = location.hostname === 'stocks-design-preview.mastergo.workers.dev';
const incomingResearch = parseResearchReturn(location.hash);
let pendingResearchLink = incomingResearch?.reportId ? incomingResearch : null;
function linkedResearchMarkup(ticker) {
  const links = readLinks(linkStorage).filter(entry => entry.ticker === ticker);
  return `<section class="linked-research"><h3>关联研究</h3>${pendingResearchLink?.ticker === ticker ? `<p>收到工作台报告入口。保存后可从此股票返回查看。</p><button id="saveReportLink" type="button">保存报告关联</button>` : ''}${links.map(entry => `<a href="${reportUrl(entry)}" target="_blank" rel="noopener">研究报告 · ${new Date(entry.reportId).toLocaleDateString('zh-CN')} ↗</a>`).join('') || '<p>暂无关联报告。完成研究后，可从工作台带回报告入口。</p>'}<small>报告保存在生成时的浏览器；此处仅保存入口。</small><p id="reportLinkStatus" role="status"></p></section>`;
}
const stockRows = [
  ["NVDA", "NVIDIA", "半导体与设备", "上游", "AI加速卡龙头", "Rubin出货节奏与客户集中度", "PPT S6", "待评级"],
  ["TSM", "Taiwan Semiconductor Manufacturing", "半导体与设备", "上游", "先进制程代工", "N2良率与CoWoS产能爬坡", "PPT S6", "待评级"],
  ["ASML", "ASML Holding", "半导体与设备", "上游", "EUV设备唯一供应商", "High-NA订单与中国出口结构", "PPT S6", "待评级"],
  ["COHR", "Coherent", "光子学与光通信", "上游", "光模块与激光器", "800G/1.6T出货与客户分散度", "PPT S7", "待评级"],
  ["LITE", "Lumentum Holdings", "光子学与光通信", "上游", "光器件与数据中心互联", "数据中心互联订单", "PPT S7", "待评级"],
  ["FN", "Fabrinet", "光子学与光通信", "上游", "光通信代工", "大客户依赖度", "PPT S7", "待评级"],
  ["CIEN", "Ciena", "光子学与光通信", "上游", "光网络系统", "运营商资本开支周期", "PPT S7", "待评级"],
  ["IPGP", "IPG Photonics", "光子学与光通信", "上游", "工业激光器", "工业需求恢复与产品迭代", "PPT S7", "待评级"],
  ["GLW", "Corning", "光子学与光通信", "上游", "光纤与特种材料", "数据中心光纤需求与显示业务恢复", "PPT S7", "待评级"],
  ["MU", "Micron Technology", "数据存储", "上游", "DRAM与HBM", "HBM3E/HBM4客户认证", "PPT S10", "待评级"],
  ["WDC", "Western Digital", "数据存储", "上游", "大容量HDD", "数据中心订单与大容量盘价格", "PPT S10", "待评级"],
  ["SNDK", "Sandisk", "数据存储", "上游", "NAND与企业级SSD", "企业级SSD占比与NAND周期", "PPT S10", "待评级"],
  ["STX", "Seagate Technology", "数据存储", "上游", "大容量HDD", "HAMR出货节奏", "PPT S10", "待评级"],
  ["DELL", "Dell Technologies", "数据中心基础设施", "中游", "AI服务器", "AI订单backlog与服务器利润率", "PPT S9", "待评级"],
  ["VRT", "Vertiv Holdings", "数据中心基础设施", "中游", "液冷与配电", "液冷渗透率与订单兑现", "PPT S9", "待评级"],
  ["CLS", "Celestica", "数据中心基础设施", "中游", "ODM制造", "超大客户集中度", "PPT S9", "待评级"],
  ["CRWV", "CoreWeave", "数据中心基础设施", "中游", "GPU云", "合同期限与资本结构", "PPT S9", "待评级"],
  ["NBIS", "Nebius Group", "数据中心基础设施", "中游", "AI基础设施服务", "客户结构与现金消耗", "PPT S9", "待评级"],
  ["CVX", "Chevron", "能源", "中游", "综合油气与基础负荷", "回购派息与天然气敞口", "PPT S13", "待评级"],
  ["LNG", "Cheniere Energy", "能源", "中游", "液化天然气出口", "长协价格与欧亚需求", "PPT S13", "待评级"],
  ["GEV", "GE Vernova", "能源", "中游", "电网与燃气轮机", "燃气轮机及电网订单backlog", "PPT S13", "待评级"],
  ["BE", "Bloom Energy", "能源", "中游", "燃料电池与分布式供电", "数据中心PPA落地", "PPT S13", "待评级"],
  ["FLNC", "Fluence Energy", "能源", "中游", "储能系统", "数据中心PPA与订单质量", "PPT S13", "待评级"],
  ["AES", "The AES Corporation", "能源", "中游", "公用事业与可再生能源", "数据中心客户合同", "PPT S13", "待评级"],
  ["SMR", "NuScale Power", "核能", "中游", "小型模块化反应堆", "监管批文与首堆并网时间表", "PPT S14", "待评级"],
  ["OKLO", "Oklo", "核能", "中游", "微型反应堆", "现金跑道与客户项目落地", "PPT S14", "待评级"],
  ["UUUU", "Energy Fuels", "核能与战略资源", "中游", "铀矿与稀土", "铀价与库存政策", "PPT S14", "待评级"],
  ["MSFT", "Microsoft", "云与软件", "下游", "Azure与Copilot", "Azure AI增速与资本开支节奏", "PPT S8", "待评级"],
  ["AMZN", "Amazon", "云与软件", "下游", "AWS与AI平台", "AWS增速与Trainium投入回报", "PPT S8", "待评级"],
  ["GOOG", "Alphabet", "云与软件", "下游", "GCP、Gemini与TPU", "自研芯片对成本结构的影响", "PPT S8", "待评级"],
  ["ORCL", "Oracle", "云与软件", "下游", "OCI与数据库AI", "RPO增长持续性与资本开支回报", "PPT S8；过往分析", "已分析"],
  ["NOW", "ServiceNow", "云与软件", "下游", "企业SaaS与AI工作流", "AI净ARR增量", "PPT S8", "待评级"],
  ["SNOW", "Snowflake", "云与软件", "下游", "云数据平台", "AI ARR与消费增长", "PPT S8", "待评级"],
  ["PLTR", "Palantir Technologies", "云与软件", "下游", "政府与商业AI平台", "商业客户净新增与合同扩张", "PPT S8", "待评级"],
  ["META", "Meta Platforms", "云与软件", "下游", "超大厂AI资本开支领先指标", "季度capex与AI变现效率", "PPT S21信号股", "待评级"],
  ["TSLA", "Tesla", "电动车", "下游", "EV、FSD、Dojo与机器人", "FSD商业化节奏", "PPT S11", "待评级"],
  ["LI", "Li Auto", "电动车", "下游", "智能电动车", "纯电产品节奏与毛利率", "PPT S11", "待评级"],
  ["XPEV", "XPeng", "电动车", "下游", "智能驾驶与电动车", "智驾订阅渗透与海外扩张", "PPT S11", "待评级"],
  ["COIN", "Coinbase Global", "加密与区块链", "下游", "加密交易所", "现货ETF净流入与衍生品业务", "PPT S12", "待评级"],
  ["RIOT", "Riot Platforms", "加密与区块链", "下游", "矿企向AI算力转型", "AI hosting合同占比", "PPT S12", "待评级"],
  ["BTDR", "Bitdeer Technologies", "加密与区块链", "下游", "矿企与AI数据中心", "AI hosting合同与电力资产价值", "PPT S12", "待评级"],
  ["IREN", "IREN Limited", "加密与区块链", "下游", "矿企与AI云", "AI云收入与数据中心扩产", "PPT S12", "待评级"],
  ["GLXY", "Galaxy Digital", "加密与区块链", "下游", "加密金融服务", "投行业务与自营仓位风险", "PPT S12", "待评级"],
  ["CRCL", "Circle Internet Group", "加密与区块链", "下游", "USDC发行方", "储备收益与利率敏感度", "PPT S12", "待评级"],
  ["RKLB", "Rocket Lab USA", "太空与国防", "下游", "火箭与卫星制造", "Neutron首飞与订单backlog", "PPT S15", "待评级"],
  ["ASTS", "AST SpaceMobile", "太空与国防", "下游", "卫星直连手机", "商业服务上线与融资需求", "PPT S15；过往分析", "已分析"],
  ["SPCX", "Space Exploration Technologies Corp. (SpaceX)", "太空与国防", "下游", "可复用火箭、Starlink卫星互联网与航天发射服务", "Starship发射节奏、Starlink用户增长、卫星互联网资本开支与上市后估值消化", "SpaceX IR / Nasdaq / SEC 8-K（2026 IPO）", "核心跟踪"],
  ["PL", "Planet Labs PBC", "太空与国防", "下游", "遥感卫星与地理数据", "政府合同续签与商业增长", "PPT S15", "待评级"],
  ["LMT", "Lockheed Martin", "太空与国防", "下游", "大型国防承包商", "海外订单与弹药补库", "PPT S15", "待评级"],
  ["RTX", "RTX Corporation", "太空与国防", "下游", "航空航天与国防系统", "海外订单、供应链与发动机成本", "PPT S15", "待评级"],
  ["AVAV", "AeroVironment", "太空与国防", "下游", "无人机与反无人机", "战术无人机订单兑现", "PPT S15", "待评级"],
  ["SITM", "SiTime", "半导体与设备", "上游", "精密时钟与MEMS振荡器", "AI数据中心时钟需求与估值", "过往分析", "已分析"],
  ["RDDT", "Reddit", "互联网平台", "下游", "社区内容与AI数据授权", "广告变现与数据授权持续性", "过往分析", "已分析"],
  ["VECO", "Veeco Instruments", "半导体与设备", "上游", "激光退火、MOCVD与硅光设备", "硅光订单、利润率与Axcelis并购", "过往分析", "已分析"],
  ["AVGO", "Broadcom", "ASIC与网络芯片", "上游", "AI ASIC、交换芯片与互联平台", "定制AI芯片收入、Tomahawk/Jericho升级与客户集中", "PPT缺口补充；Jensen Alpha Miner", "核心跟踪"],
  ["MRVL", "Marvell Technology", "ASIC与网络芯片", "上游", "定制AI芯片、DSP与光互联芯片", "定制计算收入、光DSP/PAM4需求与客户集中", "PPT缺口补充；Jensen Alpha Miner", "核心跟踪"],
  ["ANET", "Arista Networks", "数据中心网络", "中游", "AI集群以太网交换机与网络操作系统", "AI网络收入、客户集中与Etherlink竞争格局", "PPT缺口补充；Jensen Alpha Miner", "核心跟踪"],
  ["CRDO", "Credo Technology", "高速互联", "上游", "AEC、SerDes与高速连接芯片", "AEC放量、客户集中、光铜替代与估值", "PPT缺口补充；Jensen Alpha Miner", "核心跟踪"],
  ["ETN", "Eaton", "数据中心电力", "中游", "配电、UPS与电气设备", "数据中心订单、产能扩张、积压订单和估值", "PPT缺口补充；Jensen Alpha Miner", "核心跟踪"]
];

let stocks = stockRows.map(([ticker, company, sector, chain_layer, role, key_focus, source, status]) => ({
  ticker,
  company,
  market: "美股",
  category: sector,
  sector,
  chain_layer,
  role,
  key_focus,
  source,
  status,
  evidence_level: "",
  market_state: ""
}));

const relationRows = [
  ["ASML", "TSM", "产业链", "设备到先进制程"],
  ["TSM", "NVDA", "产业链", "先进制程到AI芯片"],
  ["MU", "NVDA", "产业链", "HBM到AI算力"],
  ["COHR", "NVDA", "产业链", "高速互联瓶颈"],
  ["LITE", "NVDA", "产业链", "光器件到集群互联"],
  ["FN", "COHR", "产业链", "光通信制造环节"],
  ["GLW", "COHR", "产业链", "光纤材料到光通信"],
  ["SITM", "NVDA", "产业链", "精密时钟到AI平台"],
  ["VECO", "COHR", "产业链", "硅光设备到光子学"],
  ["NVDA", "DELL", "产业链", "芯片到AI服务器"],
  ["NVDA", "CLS", "产业链", "芯片到ODM制造"],
  ["NVDA", "CRWV", "产业链", "GPU到算力云"],
  ["NVDA", "NBIS", "产业链", "GPU到AI基础设施"],
  ["DELL", "VRT", "产业链", "服务器到机房基础设施"],
  ["GEV", "VRT", "电力映射", "电网到数据中心配电"],
  ["LNG", "GEV", "电力映射", "天然气到燃机与电网"],
  ["BE", "CRWV", "电力映射", "分布式电力需求映射"],
  ["FLNC", "NBIS", "电力映射", "储能需求映射"],
  ["SMR", "CRWV", "电力映射", "长期核电需求映射"],
  ["OKLO", "NBIS", "电力映射", "微堆长期需求映射"],
  ["UUUU", "SMR", "电力映射", "核燃料主题链"],
  ["MSFT", "NVDA", "资本开支", "云厂商AI资本开支"],
  ["AMZN", "NVDA", "资本开支", "云厂商AI资本开支"],
  ["GOOG", "NVDA", "资本开支", "云厂商AI资本开支"],
  ["ORCL", "NVDA", "资本开支", "OCI算力资本开支"],
  ["META", "NVDA", "资本开支", "AI基础设施资本开支"],
  ["MSFT", "VRT", "资本开支", "数据中心机电需求"],
  ["AMZN", "MU", "资本开支", "云算力与存储需求"],
  ["META", "MU", "资本开支", "AI集群与HBM需求"],
  ["GOOG", "VRT", "资本开支", "数据中心机电需求"],
  ["TSLA", "NVDA", "主题关联", "AI终端与训练算力"],
  ["COIN", "CRCL", "产业链", "交易平台与稳定币生态"],
  ["RIOT", "IREN", "主题关联", "矿企转向AI算力"],
  ["IREN", "BTDR", "主题关联", "电力资产与AI托管"],
  ["IREN", "CRWV", "主题关联", "AI云与数据中心"],
  ["RKLB", "ASTS", "主题关联", "商业太空基础设施"],
  ["SPCX", "RKLB", "主题关联", "商业航天发射与卫星互联网"],
  ["SPCX", "ASTS", "主题关联", "卫星直连与轨道通信"],
  ["LMT", "RTX", "主题关联", "大型国防资本开支"],
  ["RDDT", "GOOG", "主题关联", "内容数据与AI变现"],
  ["AVGO", "NVDA", "主题关联", "定制ASIC与通用GPU竞争互补"],
  ["MRVL", "COHR", "产业链", "光DSP到高速光互联"],
  ["CRDO", "NVDA", "产业链", "AEC与SerDes到AI集群"],
  ["ANET", "NVDA", "产业链", "以太网交换到AI集群"],
  ["ETN", "VRT", "电力映射", "配电与数据中心机电"]
];

const baseRelationships = relationRows.map(([from, to, type, label]) => ({ from, to, type, label }));
let relationships = [...baseRelationships];

const sectorOrder = [
  "AI算力与服务器",
  "半导体设备",
  "光通信",
  "PCB与材料",
  "机器人",
  "国防军工",
  "能源与核电",
  "半导体与设备",
  "先进封装",
  "半导体材料",
  "ASIC与网络芯片",
  "高速互联",
  "光子学与光通信",
  "数据存储",
  "数据中心基础设施",
  "数据中心网络",
  "数据中心电力",
  "能源",
  "核能",
  "核能与战略资源",
  "云与软件",
  "互联网平台",
  "电动车",
  "加密与区块链",
  "太空与国防"
];

const sectorColors = {
  "AI算力与服务器": "#2e6d91",
  "半导体设备": "#c65e35",
  "光通信": "#197f73",
  "PCB与材料": "#8d6a2f",
  "机器人": "#a64e72",
  "国防军工": "#4e5fa4",
  "能源与核电": "#5b7c51",
  "半导体与设备": "#d05a2a",
  "先进封装": "#b85f38",
  "半导体材料": "#8d6a2f",
  "ASIC与网络芯片": "#b44f3b",
  "高速互联": "#148a8a",
  "光子学与光通信": "#197f73",
  "数据存储": "#6c5aa4",
  "数据中心基础设施": "#2e6d91",
  "数据中心网络": "#3e719d",
  "数据中心电力": "#9b7422",
  "能源": "#a57819",
  "核能": "#5b7c51",
  "核能与战略资源": "#7c8b4f",
  "云与软件": "#4f6677",
  "互联网平台": "#786276",
  "电动车": "#a64e72",
  "加密与区块链": "#8c6a31",
  "太空与国防": "#4e5fa4"
};

const relationClasses = {
  "产业链": "chain",
  "资本开支": "capex",
  "电力映射": "power",
  "主题关联": "theme",
  "A股映射": "mapping"
};

const layerClasses = { "上游": "upstream", "中游": "midstream", "下游": "downstream" };
const layerOrder = { "上游": 0, "中游": 1, "下游": 2 };
const focusThemes = {
  "全部": [],
  "HBM/存储": ["数据存储", "HBM", "DRAM", "NAND", "SSD", "存储", "MU", "WDC", "STX", "SNDK", "NTAP", "PSTG"],
  "CPO/光互联": ["光通信", "光子学", "高速互联", "CPO", "光互联", "光模块", "COHR", "LITE", "FN", "CIEN", "GLW", "MRVL", "CRDO"],
  "电力/液冷": ["数据中心电力", "数据中心基础设施", "能源", "核能", "液冷", "配电", "电网", "VRT", "ETN", "GEV", "BE", "FLNC", "SMR", "OKLO"],
  "先进封装": ["先进封装", "半导体材料", "封装", "CoWoS", "HBM", "AMKR", "TSM", "AMAT", "LRCX", "Q", "ENTG"],
  "机器人": ["机器人", "Physical AI", "智能驾驶", "电动车", "TSLA", "ISRG", "TER", "ROK", "三花", "拓普", "汇川"]
};

const mappingTierMeta = {
  confirmed: { label: "确认映射", className: "confirmed", note: "业务或财务端已有较直接的产业链确认，适合进入重点复核。" },
  theme: { label: "主题映射", className: "theme", note: "方向相关，但不等同于已确认供应商或客户关系。" },
  proxy: { label: "替代映射", className: "proxy", note: "更像国内代理标的，需额外核实业务纯度和收入占比。" },
  risk: { label: "高风险映射", className: "risk", note: "概念相关但证据或兑现度较弱，优先只做观察。" }
};

let stockByTicker = new Map(stocks.map((stock) => [stock.ticker, stock]));

const state = {
  query: "",
  market: "全部",
  layer: "全部",
  sector: "全部",
  status: "全部",
  relation: "全部",
  focusTheme: "全部",
  graphMode: "一度关系",
  selected: incomingResearch?.ticker || "NVDA",
  sortKey: "chain_layer",
  sortDirection: 1,
  view: "graphView"
};

const marketState = {
  quotes: {},
  asOf: null,
  source: null,
  requested: 0,
  received: 0,
  missing: [],
  markets: {},
  loading: false,
  error: null,
  stale: false,
  timer: null
};

const discoveryState = {
  candidates: [],
  papers: [],
  signals: [],
  history: [],
  status: null,
  asOf: null,
  reportHref: "",
  loaded: false,
  error: null
};

const policyState = {
  data: null,
  loaded: false,
  loading: false,
  error: null,
  timer: null,
  crowdingMode: "risk",
  crowdingTicker: null,
  crowdingExpanded: false
};

const candidateActions = {
  storageKey: "stockDiscoveryCandidateActions.v1",
  values: {}
};

const graphCanvas = {
  width: 1120,
  height: 650
};

const graphCamera = {
  scale: 1,
  x: 0,
  y: 0,
  minScale: 0.55,
  maxScale: 2.85,
  pointerId: null,
  startX: 0,
  startY: 0,
  startCameraX: 0,
  startCameraY: 0,
  startTicker: null,
  didDrag: false,
  suppressNextClick: false
};

const svgNS = "http://www.w3.org/2000/svg";

function parseCsv(text) {
  const table = [];
  let row = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      row.push(cell);
      if (row.some((value) => value !== "")) table.push(row);
      row = [];
      cell = "";
    } else {
      cell += character;
    }
  }

  if (cell || row.length) {
    row.push(cell);
    table.push(row);
  }
  if (!table.length) return [];

  const headers = table.shift().map((header) => header.replace(/^\uFEFF/, "").trim());
  return table.map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] || ""])));
}

function rebuildDataModel() {
  stockByTicker = new Map(stocks.map((stock) => [stock.ticker, stock]));
  const knownTickers = new Set(stockByTicker.keys());
  const aliases = {
    "Cloud hyperscalers": ["MSFT", "AMZN", "GOOG"],
    "NVDA rack": ["NVDA"],
    "Physical AI": ["NVDA", "TSLA"]
  };
  const mappedRelationships = [];
  const seen = new Set();

  stocks.filter((stock) => stock.market === "A股").forEach((stock) => {
    const sources = stock.source.split(/[;,；]/).map((value) => value.trim()).filter(Boolean);
    sources.forEach((source) => {
      const candidates = aliases[source] || [source.split(/\s+/)[0]];
      candidates.forEach((candidate) => {
        if (!knownTickers.has(candidate)) return;
        const key = `${candidate}|${stock.ticker}`;
        if (seen.has(key)) return;
        seen.add(key);
        mappedRelationships.push({
          from: candidate,
          to: stock.ticker,
          type: "A股映射",
          label: `${candidate} 映射至 ${stock.sector}`
        });
      });
    });
  });

  relationships = [...baseRelationships, ...mappedRelationships];
}

async function loadStockPool() {
  const response = await fetch("stock-pool.csv", { cache: "no-store" });
  if (!response.ok) throw new Error("股票池数据加载失败");
  const rows = parseCsv(await response.text());
  const normalized = rows.map((row) => ({
    ticker: row.ticker.trim().toUpperCase(),
    company: row.company.trim(),
    market: row.market || "美股",
    category: row.category || row.sector,
    sector: row.sector,
    chain_layer: row.chain_layer,
    role: row.role,
    key_focus: row.key_focus,
    source: row.source,
    status: row.status,
    evidence_level: row.evidence_level || "",
    market_state: row.market_state || "",
    added_date: row.added_date || ""
  })).filter((stock) => stock.ticker && stock.company);
  if (!normalized.length) throw new Error("股票池数据为空");
  stocks = normalized;
  rebuildDataModel();
}

function parseNumeric(value) {
  const number = Number.parseFloat(String(value || "").replace(/[$¥,%]/g, ""));
  return Number.isFinite(number) ? number : null;
}

function splitList(value) {
  return String(value || "")
    .split(/[;；]/)
    .map((item) => item.trim())
    .filter((item) => item && item !== "[]" && item !== "['']");
}

function normalizeDiscoveryCandidate(row) {
  const ticker = (row.ticker || "").trim().toUpperCase();
  const knownStock = stockByTicker.get(ticker);
  return {
    runDate: row.run_date || "",
    ticker,
    company: row.company || knownStock?.company || ticker,
    market: row.market || knownStock?.market || "",
    poolPresence: row.pool_presence || "",
    theme: row.theme || "",
    chainLayer: row.chain_layer || knownStock?.chain_layer || "",
    mappedUs: row.mapped_us || "",
    whyNow: row.why_now || "",
    totalScore: parseNumeric(row.total_score) || 0,
    recommendation: row.recommendation || "",
    reviewStatus: row.review_status || "",
    price: parseNumeric(row.price),
    changePercent: parseNumeric(row.change_percent),
    quoteTimestamp: row.quote_timestamp || "",
    notes: row.notes || "",
    supportingSignals: splitList(row.supporting_signals),
    supportingPapers: splitList(row.supporting_papers)
  };
}

function normalizeDiscoveryPaper(row) {
  return {
    arxivId: row.arxiv_id || "",
    published: row.published || "",
    title: row.title || "",
    authors: row.authors || "",
    topic: row.topic || "",
    technicalSignal: row.technical_signal || "",
    bottleneck: row.bottleneck || "",
    mappedThemes: row.mapped_themes || "",
    mappedTickers: splitList(row.mapped_tickers),
    mappedAShares: splitList(row.mapped_a_shares),
    score: parseNumeric(row.paper_signal_score) || 0,
    readthrough: row.investment_readthrough || "",
    riskNote: row.risk_note || "",
    absUrl: row.abs_url || ""
  };
}

function normalizeDiscoverySignal(row) {
  return {
    id: row.signal_id || "",
    date: row.date || "",
    sourceType: row.source_type || "",
    sourceName: row.source_name || "",
    sourceUrl: row.source_url || "",
    title: row.title || "",
    summary: row.summary || "",
    theme: row.theme || "",
    tickersMentioned: splitList(row.tickers_mentioned),
    mappedTickers: splitList(row.mapped_tickers),
    mappedAShares: splitList(row.mapped_a_shares),
    evidenceStrength: parseNumeric(row.evidence_strength) || 0,
    confidence: parseNumeric(row.confidence) || 0
  };
}

function normalizeDiscoveryHistory(row) {
  return {
    date: row.date || "",
    poolSize: parseNumeric(row.pool_size) || 0,
    quotesRequested: parseNumeric(row.quotes_requested) || 0,
    quotesReceived: parseNumeric(row.quotes_received) || 0,
    missingQuotes: splitList(row.missing_quotes),
    extraQuotes: parseNumeric(row.extra_quotes) || 0,
    usableQuotes: parseNumeric(row.usable_quotes) || 0,
    signals: parseNumeric(row.signals) || 0,
    arxivPapers: parseNumeric(row.arxiv_papers) || 0,
    candidates: parseNumeric(row.candidates) || 0,
    observeCount: parseNumeric(row.observe_count) || 0,
    observeTickers: splitList(row.observe_tickers),
    reportHref: row.report_href || ""
  };
}

async function loadDiscoveryCsv(path) {
  const response = await fetch(path, { cache: "no-store" });
  if (!response.ok) throw new Error(`${path} 加载失败`);
  return parseCsv(await response.text());
}

async function loadDiscoveryData() {
  const failures = [];
  const safeLoad = async (path) => {
    try {
      return await loadDiscoveryCsv(path);
    } catch (error) {
      failures.push(error instanceof Error ? error.message : `${path} 加载失败`);
      return [];
    }
  };

  const safeLoadJson = async (path) => {
    try {
      const response = await fetch(path, { cache: "no-store" });
      if (!response.ok) return null;
      return await response.json();
    } catch {
      return null;
    }
  };

  const [candidateRows, paperRows, signalRows, historyRows, discoveryStatus] = await Promise.all([
    safeLoad("discovery-candidates.csv"),
    safeLoad("arxiv-papers.csv"),
    safeLoad("discovery-signals.csv"),
    safeLoad("discovery-history.csv"),
    safeLoadJson("discovery-status.json")
  ]);

  discoveryState.candidates = candidateRows
    .map(normalizeDiscoveryCandidate)
    .filter((candidate) => candidate.ticker)
    .sort((left, right) => right.totalScore - left.totalScore || left.ticker.localeCompare(right.ticker));
  discoveryState.papers = paperRows
    .map(normalizeDiscoveryPaper)
    .filter((paper) => paper.arxivId || paper.title)
    .sort((left, right) => right.score - left.score || String(right.published).localeCompare(String(left.published)));
  discoveryState.signals = signalRows
    .map(normalizeDiscoverySignal)
    .filter((signal) => signal.id || signal.title)
    .sort((left, right) => right.confidence - left.confidence || right.evidenceStrength - left.evidenceStrength);
  discoveryState.history = historyRows
    .map(normalizeDiscoveryHistory)
    .filter((item) => item.date)
    .sort((left, right) => String(left.date).localeCompare(String(right.date)));
  discoveryState.status = discoveryStatus && typeof discoveryStatus === "object" ? discoveryStatus : null;

  discoveryState.asOf = discoveryState.candidates[0]?.runDate || discoveryState.signals[0]?.date || discoveryState.papers[0]?.published || null;
  discoveryState.reportHref = discoveryState.asOf ? `reports/discovery-${discoveryState.asOf}.md` : "";
  discoveryState.loaded = true;
  discoveryState.error = discoveryState.candidates.length ? null : failures.join("；") || "主动发现数据暂不可用";
}

async function loadPolicyData(force = false) {
  if (policyState.loading) return;
  policyState.loading = true;
  if (policyState.loaded) renderPolicy();
  try {
    const response = await fetch(`/api/policy${force ? "?refresh=1" : ""}`, { cache: "no-store" });
    if (!response.ok) throw new Error("政策压力数据加载失败");
    const payload = await response.json();
    if (!Number.isFinite(Number(payload?.index?.value))) throw new Error("政策压力数据格式异常");
    policyState.data = payload;
    policyState.error = null;
  } catch (error) {
    policyState.error = error instanceof Error ? error.message : "政策压力实时数据暂不可用";
    try {
      const fallbackResponse = await fetch("tpi-latest.json", { cache: "no-store" });
      if (!fallbackResponse.ok) throw new Error("回退快照加载失败");
      const fallback = await fallbackResponse.json();
      policyState.data = { ...fallback, status: "fallback" };
    } catch {
      policyState.data = null;
    }
  } finally {
    policyState.loaded = true;
    policyState.loading = false;
    renderPolicy();
  }
}

function loadCandidateActions() {
  try {
    candidateActions.values = JSON.parse(window.localStorage.getItem(candidateActions.storageKey) || "{}") || {};
  } catch {
    candidateActions.values = {};
  }
}

function saveCandidateActions() {
  try {
    window.localStorage.setItem(candidateActions.storageKey, JSON.stringify(candidateActions.values));
  } catch {
    // localStorage may be unavailable in private contexts; the UI still works for the current render.
  }
}

function getCandidateAction(ticker) {
  return candidateActions.values[ticker] || "";
}

function setCandidateAction(ticker, action) {
  if (!ticker) return;
  if (!action) delete candidateActions.values[ticker];
  else candidateActions.values[ticker] = {
    action,
    updatedAt: new Date().toISOString()
  };
  saveCandidateActions();
  renderAll();
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function createSvg(tag, attributes = {}) {
  const element = document.createElementNS(svgNS, tag);
  Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, String(value)));
  return element;
}

function clampValue(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function applyGraphCamera() {
  const viewport = document.getElementById("graphViewport");
  if (viewport) {
    viewport.setAttribute(
      "transform",
      `translate(${graphCamera.x.toFixed(2)} ${graphCamera.y.toFixed(2)}) scale(${graphCamera.scale.toFixed(4)})`
    );
  }
  updateGraphControlUi();
}

function updateGraphControlUi() {
  const zoomValue = document.getElementById("graphZoomValue");
  const zoomIn = document.getElementById("graphZoomIn");
  const zoomOut = document.getElementById("graphZoomOut");
  const fullscreen = document.getElementById("graphFullscreen");
  if (zoomValue) zoomValue.textContent = `${Math.round(graphCamera.scale * 100)}%`;
  if (zoomIn) zoomIn.disabled = graphCamera.scale >= graphCamera.maxScale - 0.01;
  if (zoomOut) zoomOut.disabled = graphCamera.scale <= graphCamera.minScale + 0.01;
  if (fullscreen) {
    const active = isGraphFullscreen();
    fullscreen.setAttribute("aria-pressed", String(active));
    fullscreen.title = active ? "退出全屏" : "全屏查看图谱";
    fullscreen.setAttribute("aria-label", active ? "退出全屏" : "全屏查看图谱");
  }
}

function resetGraphCamera() {
  graphCamera.scale = 1;
  graphCamera.x = 0;
  graphCamera.y = 0;
  applyGraphCamera();
}

function getGraphPoint(event) {
  const svg = document.getElementById("networkGraph");
  if (!svg || !svg.createSVGPoint) return { x: graphCanvas.width / 2, y: graphCanvas.height / 2 };
  const point = svg.createSVGPoint();
  point.x = event.clientX;
  point.y = event.clientY;
  const matrix = svg.getScreenCTM();
  if (!matrix) return { x: graphCanvas.width / 2, y: graphCanvas.height / 2 };
  const transformed = point.matrixTransform(matrix.inverse());
  return { x: transformed.x, y: transformed.y };
}

function getGraphCenterPoint() {
  return { x: graphCanvas.width / 2, y: graphCanvas.height / 2 };
}

function zoomGraphTo(nextScale, origin = getGraphCenterPoint()) {
  const scale = clampValue(nextScale, graphCamera.minScale, graphCamera.maxScale);
  const worldX = (origin.x - graphCamera.x) / graphCamera.scale;
  const worldY = (origin.y - graphCamera.y) / graphCamera.scale;
  graphCamera.scale = scale;
  graphCamera.x = origin.x - worldX * scale;
  graphCamera.y = origin.y - worldY * scale;
  applyGraphCamera();
}

function zoomGraphBy(factor, origin) {
  zoomGraphTo(graphCamera.scale * factor, origin);
}

function isGraphFullscreen() {
  const stage = document.getElementById("networkStage");
  return Boolean(stage && (document.fullscreenElement === stage || document.webkitFullscreenElement === stage));
}

async function toggleGraphFullscreen() {
  const stage = document.getElementById("networkStage");
  if (!stage) return;
  try {
    if (isGraphFullscreen()) {
      if (document.exitFullscreen) await document.exitFullscreen();
      else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
    } else if (stage.requestFullscreen) {
      await stage.requestFullscreen();
    } else if (stage.webkitRequestFullscreen) {
      stage.webkitRequestFullscreen();
    }
  } finally {
    updateGraphControlUi();
  }
}

function getQuote(ticker) {
  return marketState.quotes[ticker] || null;
}

function formatPrice(value, currency = "USD") {
  if (!Number.isFinite(value)) return "—";
  const digits = Math.abs(value) < 1 ? 4 : 2;
  const symbol = currency === "CNY" ? "¥" : "$";
  return `${symbol}${value.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

function displayTicker(ticker) {
  return ticker.replace(/\.(SZ|SS|BJ)$/i, "");
}

function formatPercent(value) {
  if (!Number.isFinite(value)) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

function formatVolume(value) {
  if (!Number.isFinite(value)) return "—";
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)}B`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(Math.round(value));
}

function quoteClass(value) {
  if (!Number.isFinite(value) || value === 0) return "quote-flat";
  return value > 0 ? "quote-up" : "quote-down";
}

function researchStatusClass(status) {
  if (["核心跟踪", "持仓核心"].includes(status)) return "core";
  if (["过热观察", "高估值候选"].includes(status)) return "caution";
  if (["已分析", "原核心池", "正式新增", "持仓验证", "核电子池", "国防观察池"].includes(status)) return "analyzed";
  if (String(status).includes("核心")) return "core";
  if (/过热|高位|高估值|昂贵|等回踩|回调/.test(String(status))) return "caution";
  if (/分析|新增|验证|观察池|子池/.test(String(status))) return "analyzed";
  return "pending";
}

function formatAsOf(value) {
  if (!value) return "--:--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--:--";
  return date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
}

function getFilteredStocks() {
  const query = state.query.trim().toLowerCase();
  const focusTerms = focusThemes[state.focusTheme] || [];
  return stocks.filter((stock) => {
    const haystack = [stock.ticker, stock.company, stock.market, stock.category, stock.sector, stock.role, stock.key_focus, stock.source].join(" ").toLowerCase();
    const matchesFocus = !focusTerms.length || focusTerms.some((term) => haystack.includes(String(term).toLowerCase()));
    return (!query || haystack.includes(query))
      && matchesFocus
      && (state.market === "全部" || stock.market === state.market)
      && (state.layer === "全部" || stock.chain_layer === state.layer)
      && (state.sector === "全部" || stock.category === state.sector)
      && (state.status === "全部" || stock.status === state.status);
  });
}

function getVisibleRelationships(visibleTickers) {
  return relationships.filter((relation) => visibleTickers.has(relation.from)
    && visibleTickers.has(relation.to)
    && (state.relation === "全部" || relation.type === state.relation)
    && (state.graphMode !== "隐藏弱关系" || relation.type !== "主题关联"));
}

function getConnections(ticker) {
  return relationships.filter((relation) => relation.from === ticker || relation.to === ticker);
}

function setActiveButton(container, value) {
  container.querySelectorAll("button").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.value === value);
  });
}

function renderSectorFilters() {
  const container = document.getElementById("sectorFilters");
  const marketStocks = state.market === "全部" ? stocks : stocks.filter((stock) => stock.market === state.market);
  const extraSectors = [...new Set(marketStocks.map((stock) => stock.category))].filter((sector) => !sectorOrder.includes(sector));
  const availableSectors = [...sectorOrder, ...extraSectors].filter((sector) => marketStocks.some((stock) => stock.category === sector));
  const counts = new Map(availableSectors.map((sector) => [sector, marketStocks.filter((stock) => stock.category === sector).length]));
  const buttons = [
    `<button type="button" class="sector-button ${state.sector === "全部" ? "is-active" : ""}" data-value="全部">
      <span class="sector-swatch" style="background:#aab4b8"></span><span>全部板块</span><em>${marketStocks.length}</em>
    </button>`,
    ...availableSectors.map((sector) => `<button type="button" class="sector-button ${state.sector === sector ? "is-active" : ""}" data-value="${escapeHtml(sector)}">
      <span class="sector-swatch" style="background:${sectorColors[sector] || "#687d86"}"></span><span>${escapeHtml(sector)}</span><em>${counts.get(sector)}</em>
    </button>`)
  ];
  container.innerHTML = buttons.join("");
  container.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => {
      state.sector = button.dataset.value;
      renderAll();
    });
  });
  document.getElementById("sectorCount").textContent = availableSectors.length;
}

function renderStatusFilters() {
  const container = document.getElementById("statusFilter");
  const marketStocks = state.market === "全部" ? stocks : stocks.filter((stock) => stock.market === state.market);
  const preferredOrder = ["持仓核心", "核心跟踪", "正式新增", "已分析", "原核心池", "持仓验证", "过热观察", "高估值候选", "核电子池", "国防观察池", "待评级"];
  const statuses = [...new Set(marketStocks.map((stock) => stock.status))]
    .sort((left, right) => preferredOrder.indexOf(left) - preferredOrder.indexOf(right));
  const buttons = [
    `<button type="button" class="${state.status === "全部" ? "is-active" : ""}" data-value="全部"><span class="status-dot pending"></span>全部状态</button>`,
    ...statuses.map((status) => {
      const statusClass = researchStatusClass(status);
      const count = marketStocks.filter((stock) => stock.status === status).length;
      return `<button type="button" class="${state.status === status ? "is-active" : ""}" data-value="${escapeHtml(status)}"><span class="status-dot ${statusClass}"></span>${escapeHtml(status)}<em>${count}</em></button>`;
    })
  ];
  container.innerHTML = buttons.join("");
  container.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => {
      state.status = button.dataset.value;
      renderAll();
    });
  });
}

function buildPositions(visibleStocks) {
  const positions = new Map();
  const bands = {
    "上游": { left: 18, right: 354 },
    "中游": { left: 392, right: 728 },
    "下游": { left: 766, right: 1102 }
  };

  ["上游", "中游", "下游"].forEach((layer) => {
    const items = visibleStocks
      .filter((stock) => stock.chain_layer === layer)
      .sort((a, b) => sectorOrder.indexOf(a.category) - sectorOrder.indexOf(b.category) || a.ticker.localeCompare(b.ticker));
    if (!items.length) return;

    const columns = state.graphMode === "一度关系" ? (items.length > 18 ? 3 : items.length > 7 ? 2 : 1) : (items.length > 30 ? 4 : items.length > 18 ? 3 : items.length > 7 ? 2 : 1);
    const rows = Math.ceil(items.length / columns);
    const band = bands[layer];
    const xValues = Array.from({ length: columns }, (_, index) => {
      const inset = state.graphMode === "一度关系" ? 60 : 42;
      const usableWidth = band.right - band.left - inset * 2;
      return band.left + inset + (columns === 1 ? usableWidth / 2 : (usableWidth * index) / (columns - 1));
    });
    const step = rows <= 1 ? 0 : Math.min(state.graphMode === "一度关系" ? 72 : 42, 510 / (rows - 1));
    const totalHeight = Math.max(0, (rows - 1) * step);
    const startY = 92 + (510 - totalHeight) / 2;

    items.forEach((stock, index) => {
      const column = Math.floor(index / rows);
      const row = index % rows;
      positions.set(stock.ticker, { x: xValues[column], y: startY + row * step });
    });
  });
  return { positions, bands };
}

function renderGraph(visibleStocks) {
  const svg = document.getElementById("networkGraph");
  svg.innerHTML = "";

  let graphStocks = visibleStocks;
  if (state.graphMode === "一度关系" && state.selected) {
    const neighborhood = new Set([state.selected]);
    relationships.forEach((relation) => {
      if (relation.from === state.selected) neighborhood.add(relation.to);
      if (relation.to === state.selected) neighborhood.add(relation.from);
    });
    graphStocks = visibleStocks.filter((stock) => neighborhood.has(stock.ticker));
  }

  if (!graphStocks.length) {
    const empty = createSvg("text", { x: 560, y: 325, "text-anchor": "middle", fill: "#7f8b91", "font-size": 14 });
    empty.textContent = "当前筛选没有匹配标的";
    svg.appendChild(empty);
    updateGraphControlUi();
    return;
  }

  svg.classList.toggle('focused-map', state.graphMode === '一度关系');
  const { positions, bands } = buildPositions(graphStocks);
  const visibleTickers = new Set(graphStocks.map((stock) => stock.ticker));
  const visibleRelationships = getVisibleRelationships(visibleTickers);
  const connectedToSelection = new Set();
  if (state.selected) {
    visibleRelationships.forEach((relation) => {
      if (relation.from === state.selected) connectedToSelection.add(relation.to);
      if (relation.to === state.selected) connectedToSelection.add(relation.from);
    });
  }

  const defs = createSvg("defs");
  [
    ["chain", "#c56336"],
    ["capex", "#3d7796"],
    ["power", "#5f8357"],
    ["theme", "#8a7c9e"],
    ["mapping", "#9b7422"]
  ].forEach(([name, color]) => {
    const marker = createSvg("marker", {
      id: `arrow-${name}`,
      viewBox: "0 0 8 8",
      refX: 7,
      refY: 4,
      markerWidth: 5,
      markerHeight: 5,
      orient: "auto-start-reverse"
    });
    marker.appendChild(createSvg("path", { d: "M0 0 L8 4 L0 8 Z", fill: color }));
    defs.appendChild(marker);
  });
  svg.appendChild(defs);

  const viewport = createSvg("g", { id: "graphViewport" });
  svg.appendChild(viewport);

  ["上游", "中游", "下游"].forEach((layer, index) => {
    const band = bands[layer];
    const count = graphStocks.filter((stock) => stock.chain_layer === layer).length;
    const rect = createSvg("rect", {
      x: band.left,
      y: 12,
      width: band.right - band.left,
      height: 626,
      rx: 4,
      class: `layer-band ${index === 1 ? "middle" : ""}`,
      "data-background": "true"
    });
    viewport.appendChild(rect);
    const title = createSvg("text", { x: band.left + 16, y: 39, class: "layer-title", "data-background": "true" });
    title.textContent = layer;
    viewport.appendChild(title);
    const countLabel = createSvg("text", { x: band.right - 16, y: 39, class: "layer-count", "text-anchor": "end", "data-background": "true" });
    countLabel.textContent = `${count} STOCKS`;
    viewport.appendChild(countLabel);
  });

  visibleRelationships.forEach((relation) => {
    const from = positions.get(relation.from);
    const to = positions.get(relation.to);
    if (!from || !to) return;
    const direction = to.x >= from.x ? 1 : -1;
    const startX = from.x + direction * 34;
    const endX = to.x - direction * 34;
    let d;
    if (Math.abs(to.x - from.x) < 80) {
      const bend = Math.max(from.x, to.x) + 52;
      d = `M ${from.x} ${from.y} C ${bend} ${from.y}, ${bend} ${to.y}, ${to.x} ${to.y}`;
    } else {
      const middleX = (startX + endX) / 2;
      d = `M ${startX} ${from.y} C ${middleX} ${from.y}, ${middleX} ${to.y}, ${endX} ${to.y}`;
    }
    const className = relationClasses[relation.type];
    const path = createSvg("path", {
      d,
      class: `relation-line ${className}`,
      "marker-end": `url(#arrow-${className})`
    });
    const isConnected = state.selected && (relation.from === state.selected || relation.to === state.selected);
    if (isConnected) path.classList.add("is-connected");
    if (state.selected && !isConnected) path.classList.add("is-dimmed");
    const title = createSvg("title");
    title.textContent = `${relation.from} → ${relation.to} · ${relation.label}`;
    path.appendChild(title);
    viewport.appendChild(path);
  });

  graphStocks.forEach((stock) => {
    const position = positions.get(stock.ticker);
    if (!position) return;
    const group = createSvg("g", {
      class: "stock-node",
      tabindex: 0,
      role: "button",
      "aria-label": `${stock.ticker} ${stock.company}`,
      "data-ticker": stock.ticker
    });
    if (state.selected === stock.ticker) group.classList.add("is-selected");
    if (connectedToSelection.has(stock.ticker)) group.classList.add("is-related");
    if (state.selected && state.selected !== stock.ticker && !connectedToSelection.has(stock.ticker)) group.classList.add("is-dimmed");

    group.appendChild(createSvg("rect", {
      x: position.x - (state.graphMode === "一度关系" ? 48 : 34),
      y: position.y - (state.graphMode === "一度关系" ? 22 : 17),
      width: state.graphMode === "一度关系" ? 96 : 68,
      height: state.graphMode === "一度关系" ? 44 : 34,
      rx: 4,
      fill: sectorColors[stock.category] || "#687d86"
    }));
    const label = createSvg("text", { x: position.x, y: position.y - 4, class: "node-ticker" });
    label.textContent = displayTicker(stock.ticker);
    group.appendChild(label);
    const nodeQuote = getQuote(stock.ticker);
    const changeLabel = createSvg("text", { x: position.x, y: position.y + 9, class: "node-change" });
    changeLabel.textContent = state.graphMode === "一度关系" ? stock.company.slice(0, 9) : nodeQuote ? formatPercent(nodeQuote.changePercent) : "--";
    group.appendChild(changeLabel);
    const statusClass = researchStatusClass(stock.status);
    if (statusClass !== "pending") {
      group.appendChild(createSvg("circle", {
        cx: position.x + 29,
        cy: position.y - 13,
        r: 3.7,
        class: statusClass === "core" ? "core-ring" : statusClass === "caution" ? "caution-ring" : "analyzed-ring"
      }));
    }

    group.addEventListener("click", (event) => {
      if (graphCamera.suppressNextClick) {
        event.stopPropagation();
        return;
      }
      event.stopPropagation();
      selectStock(stock.ticker);
    });
    group.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        selectStock(stock.ticker);
      }
    });
    group.addEventListener("pointerenter", (event) => showTooltip(event, stock));
    group.addEventListener("pointermove", (event) => moveTooltip(event));
    group.addEventListener("pointerleave", hideTooltip);
    viewport.appendChild(group);
  });

  viewport.querySelectorAll('[data-background="true"]').forEach((element) => {
    element.addEventListener("click", () => {
      if (graphCamera.suppressNextClick) return;
      state.selected = null;
      hideTooltip();
      renderAll();
    });
  });
  applyGraphCamera();
}

function showTooltip(event, stock) {
  const tooltip = document.getElementById("graphTooltip");
  const quote = getQuote(stock.ticker);
  const quoteText = quote
    ? `${formatPrice(quote.price, quote.currency)} · <span class="${quoteClass(quote.changePercent)}">${formatPercent(quote.changePercent)}</span>`
    : "行情加载中";
  tooltip.innerHTML = `<strong>${escapeHtml(stock.ticker)} · ${escapeHtml(stock.company)}</strong>${escapeHtml(stock.market)} · ${quoteText}<br>${escapeHtml(stock.role)}`;
  tooltip.hidden = false;
  moveTooltip(event);
}

function moveTooltip(event) {
  const stage = document.getElementById("networkStage");
  const tooltip = document.getElementById("graphTooltip");
  if (tooltip.hidden) return;
  const rect = stage.getBoundingClientRect();
  const tooltipWidth = tooltip.offsetWidth || 200;
  const tooltipHeight = tooltip.offsetHeight || 54;
  const left = Math.min(event.clientX - rect.left + 12, rect.width - tooltipWidth - 8);
  const top = Math.min(event.clientY - rect.top + 12, rect.height - tooltipHeight - 8);
  tooltip.style.left = `${Math.max(8, left)}px`;
  tooltip.style.top = `${Math.max(8, top)}px`;
}

function hideTooltip() {
  document.getElementById("graphTooltip").hidden = true;
}

function handleGraphWheel(event) {
  event.preventDefault();
  hideTooltip();
  const normalizedDelta = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY;
  const factor = Math.exp(-normalizedDelta * 0.0015);
  zoomGraphBy(factor, getGraphPoint(event));
}

function beginGraphPan(event) {
  const target = event.target instanceof Element ? event.target : null;
  if (event.button !== 0 || target?.closest(".graph-controls")) return;
  const stage = document.getElementById("networkStage");
  graphCamera.pointerId = event.pointerId;
  graphCamera.startX = event.clientX;
  graphCamera.startY = event.clientY;
  graphCamera.startCameraX = graphCamera.x;
  graphCamera.startCameraY = graphCamera.y;
  graphCamera.startTicker = target?.closest(".stock-node")?.dataset.ticker || null;
  graphCamera.didDrag = false;
  stage.classList.add("is-dragging");
  stage.focus({ preventScroll: true });
  stage.setPointerCapture?.(event.pointerId);
  hideTooltip();
}

function moveGraphPan(event) {
  if (graphCamera.pointerId !== event.pointerId) return;
  event.preventDefault();
  const stage = document.getElementById("networkStage");
  const rect = stage.getBoundingClientRect();
  const dx = event.clientX - graphCamera.startX;
  const dy = event.clientY - graphCamera.startY;
  if (Math.hypot(dx, dy) > 3) graphCamera.didDrag = true;
  graphCamera.x = graphCamera.startCameraX + dx * (graphCanvas.width / Math.max(1, rect.width));
  graphCamera.y = graphCamera.startCameraY + dy * (graphCanvas.height / Math.max(1, rect.height));
  applyGraphCamera();
}

function endGraphPan(event) {
  if (graphCamera.pointerId !== event.pointerId) return;
  const stage = document.getElementById("networkStage");
  stage.classList.remove("is-dragging");
  stage.releasePointerCapture?.(event.pointerId);
  if (graphCamera.didDrag) {
    graphCamera.suppressNextClick = true;
    window.setTimeout(() => {
      graphCamera.suppressNextClick = false;
    }, 160);
  } else if (graphCamera.startTicker) {
    const ticker = graphCamera.startTicker;
    graphCamera.suppressNextClick = true;
    selectStock(ticker);
    window.setTimeout(() => {
      graphCamera.suppressNextClick = false;
    }, 160);
  }
  graphCamera.startTicker = null;
  graphCamera.pointerId = null;
}

function handleGraphDoubleClick(event) {
  const target = event.target instanceof Element ? event.target : null;
  if (target?.closest(".graph-controls, .stock-node")) return;
  event.preventDefault();
  resetGraphCamera();
}

function handleGraphKeydown(event) {
  if (event.key === "+" || event.key === "=") {
    event.preventDefault();
    zoomGraphBy(1.18);
  } else if (event.key === "-" || event.key === "_") {
    event.preventDefault();
    zoomGraphBy(1 / 1.18);
  } else if (event.key === "0") {
    event.preventDefault();
    resetGraphCamera();
  } else if (event.key.toLowerCase() === "f") {
    event.preventDefault();
    toggleGraphFullscreen();
  }
}

function initializeGraphInteractions() {
  const stage = document.getElementById("networkStage");
  stage.addEventListener("wheel", handleGraphWheel, { passive: false });
  stage.addEventListener("pointerdown", beginGraphPan);
  stage.addEventListener("pointermove", moveGraphPan);
  stage.addEventListener("pointerup", endGraphPan);
  stage.addEventListener("pointercancel", endGraphPan);
  stage.addEventListener("dblclick", handleGraphDoubleClick);
  stage.addEventListener("keydown", handleGraphKeydown);

  document.getElementById("graphZoomIn").addEventListener("click", () => zoomGraphBy(1.18));
  document.getElementById("graphZoomOut").addEventListener("click", () => zoomGraphBy(1 / 1.18));
  document.getElementById("graphZoomReset").addEventListener("click", resetGraphCamera);
  document.getElementById("graphFullscreen").addEventListener("click", toggleGraphFullscreen);
  document.addEventListener("fullscreenchange", updateGraphControlUi);
  document.addEventListener("webkitfullscreenchange", updateGraphControlUi);
  applyGraphCamera();
}

function renderDetail(visibleStocks) {
  const panel = document.getElementById("detailPanel");
  const selected = state.selected ? stockByTicker.get(state.selected) : null;
  if (!selected || !visibleStocks.some((stock) => stock.ticker === selected.ticker)) {
    const layerCounts = ["上游", "中游", "下游"].map((layer) => [layer, visibleStocks.filter((stock) => stock.chain_layer === layer).length]);
    const largestSectors = sectorOrder
      .map((sector) => ({ sector, count: visibleStocks.filter((stock) => stock.category === sector).length }))
      .filter((item) => item.count)
      .sort((a, b) => b.count - a.count)
      .slice(0, 4);
    panel.innerHTML = `
      <div class="detail-kicker"><span>Universe structure</span><span>${visibleStocks.length} stocks</span></div>
      <h2 class="detail-title">3 × ${new Set(visibleStocks.map((stock) => stock.category)).size}</h2>
      <p class="detail-company">产业位置 × 主题板块</p>
      <p class="detail-role">从物理瓶颈、算力基础设施到下游变现，形成一条完整的AI资本开支观察链。</p>
      <section class="detail-section">
        <h3>产业层级</h3>
        <div class="meta-grid">
          ${layerCounts.map(([layer, count]) => `<div><span>${layer}</span><strong>${count} 个标的</strong></div>`).join("")}
          <div><span>重点状态</span><strong>${visibleStocks.filter((stock) => researchStatusClass(stock.status) !== "pending").length} 个标的</strong></div>
        </div>
      </section>
      <section class="detail-section">
        <h3>主要板块</h3>
        <div class="related-list">
          ${largestSectors.map((item) => `<button type="button" class="peer-button" data-sector="${escapeHtml(item.sector)}"><strong>${escapeHtml(item.sector)}</strong><span>${item.count}</span></button>`).join("") || "<p>当前没有匹配板块</p>"}
        </div>
      </section>`;
    panel.querySelectorAll("[data-sector]").forEach((button) => {
      button.addEventListener("click", () => {
        state.sector = button.dataset.sector;
        renderAll();
      });
    });
    return;
  }

  const connections = getConnections(selected.ticker);
  const peers = stocks
    .filter((stock) => stock.category === selected.category && stock.ticker !== selected.ticker)
    .slice(0, 8);
  const statusClass = researchStatusClass(selected.status);
  const quote = getQuote(selected.ticker);
  const candidateMatches = getCandidatesForTicker(selected.ticker);
  const primaryCandidate = candidateMatches[0];
  const signalMatches = getSignalsForTicker(selected.ticker, 5);
  const paperMatches = getPapersForTicker(selected.ticker, 5);
  const mappingTier = getMappingTier(selected);
  const decisionStatus = getDecisionStatus(selected);
  const tradePosition = getTradePosition(selected, quote);
  const actionValue = getCandidateActionValue(selected.ticker);
  const quoteBlock = quote
    ? `<div class="live-quote"><strong>${formatPrice(quote.price, quote.currency)}</strong><span class="${quoteClass(quote.changePercent)}">${formatPercent(quote.changePercent)}</span></div>`
    : `<div class="live-quote"><strong class="quote-missing">行情加载中</strong><span>—</span></div>`;
  panel.innerHTML = `
    <div class="detail-kicker">
      <span>${escapeHtml(selected.market)} · ${escapeHtml(selected.sector)}</span>
      <span class="detail-status ${statusClass}">${escapeHtml(selected.status)}</span>
    </div>
    <h2 class="detail-title">${escapeHtml(selected.ticker)}</h2>
    <p class="detail-company">${escapeHtml(selected.company)}</p>
    ${quoteBlock}
    <section class="research-handoff-panel">
      <h3>带入研究的内容</h3><p>${escapeHtml(selected.company)} · ${escapeHtml(selected.ticker)}</p><p>产业主题：${escapeHtml(selected.category)}</p>
      <label><input id="includeResearchQuestion" type="checkbox" checked /> 包含待验证问题</label><p class="handoff-question">${escapeHtml(selected.key_focus || '核对增长动力、订单与主要风险')}</p>
      <a id="openResearchWorkspace" class="research-primary" href="${escapeHtml(makeResearchUrl(selected, isDesignPreview))}" target="_blank" rel="noopener">带入工作台研究 ↗</a>
      <small>先载入草稿，再开始分析，不会自动调用模型。</small>
    </section>
    ${linkedResearchMarkup(selected.ticker)}
    <div class="research-card-banner">
      <div><span>决策状态</span><strong>${escapeHtml(decisionStatus)}</strong></div>
      <div><span>交易位置</span><strong>${escapeHtml(tradePosition)}</strong></div>
      <div><span>发现分数</span><strong>${primaryCandidate ? Math.round(primaryCandidate.totalScore) : "—"}</strong></div>
    </div>
    <p class="detail-role">${escapeHtml(selected.role)}</p>
    <section class="detail-section">
      <h3>关键观察</h3>
      <p>${escapeHtml(selected.key_focus)}</p>
    </section>
    <section class="detail-section">
      <div class="meta-grid">
        <div><span>市场</span><strong>${escapeHtml(selected.market)}</strong></div>
        <div><span>产业位置</span><strong>${escapeHtml(selected.chain_layer)}</strong></div>
        <div><span>显式关联</span><strong>${connections.length}</strong></div>
        <div><span>${selected.market === "A股" ? "美股映射" : "来源"}</span><strong>${escapeHtml(selected.source)}</strong></div>
        <div><span>主题规模</span><strong>${stocks.filter((stock) => stock.category === selected.category).length}</strong></div>
        <div><span>证据等级</span><strong>${escapeHtml(selected.evidence_level || "—")}</strong></div>
        <div><span>日内高 / 低</span><strong>${quote ? `${formatPrice(quote.dayHigh, quote.currency)} / ${formatPrice(quote.dayLow, quote.currency)}` : "—"}</strong></div>
        <div><span>成交量</span><strong>${quote ? formatVolume(quote.volume) : "—"}</strong></div>
        <div><span>位置备注</span><strong>${escapeHtml(selected.market_state || "—")}</strong></div>
      </div>
    </section>
    ${mappingTier ? `<section class="detail-section mapping-tier-card ${mappingTier.className}">
      <h3>A股映射等级</h3>
      <div class="mapping-tier-head"><strong>${escapeHtml(mappingTier.label)}</strong><span>${escapeHtml(selected.source || "—")}</span></div>
      <p>${escapeHtml(mappingTier.note)}</p>
    </section>` : ""}
    <section class="detail-section">
      <h3>候选处理</h3>
      <div class="candidate-actions detail-actions" data-ticker="${escapeHtml(selected.ticker)}">
        <button type="button" data-action="watch" class="${actionValue === "watch" ? "is-active" : ""}">观察</button>
        <button type="button" data-action="promote" class="${actionValue === "promote" ? "is-active" : ""}">入池候选</button>
        <button type="button" data-action="ignore" class="${actionValue === "ignore" ? "is-active" : ""}">忽略</button>
        <button type="button" data-action="research" class="${actionValue === "research" ? "is-active" : ""}">研究卡</button>
      </div>
    </section>
    <section class="detail-section">
      <h3>证据链</h3>
      <div class="evidence-grid">
        <div><h4>新闻 / 官方信号</h4>${renderEvidenceList(signalMatches, "新闻")}</div>
        <div><h4>arXiv 技术信号</h4>${renderEvidenceList(paperMatches, "论文")}</div>
      </div>
    </section>
    <section class="detail-section">
      <h3>关联标的</h3>
      <div class="related-list">
        ${connections.map((relation) => {
          const otherTicker = relation.from === selected.ticker ? relation.to : relation.from;
          return `<button type="button" class="related-item" data-select="${otherTicker}"><strong>${displayTicker(otherTicker)}</strong><span>${escapeHtml(relation.type)} · ${escapeHtml(relation.label)}</span></button>`;
        }).join("") || "<p>暂无显式关联</p>"}
      </div>
    </section>
    <section class="detail-section">
      <h3>同板块</h3>
      <div class="peer-grid">
        ${peers.map((peer) => `<button type="button" class="peer-button" data-select="${peer.ticker}"><strong>${displayTicker(peer.ticker)}</strong><span>${escapeHtml(peer.market)} · ${escapeHtml(peer.role)}</span></button>`).join("") || "<p>暂无同板块标的</p>"}
      </div>
    </section>`;
  panel.querySelector('#includeResearchQuestion')?.addEventListener('change', event => {
    panel.querySelector('#openResearchWorkspace').href = makeResearchUrl(selected, isDesignPreview, event.target.checked);
  });
  panel.querySelector('#saveReportLink')?.addEventListener('click', () => {
    if (!pendingResearchLink) return;
    if (saveLink(linkStorage, pendingResearchLink)) {
      pendingResearchLink = null; renderDetail(visibleStocks);
      window.history.replaceState(null, '', location.pathname + location.search);
    } else panel.querySelector('#reportLinkStatus').textContent = '浏览器无法保存，请检查存储空间或权限。';
  });
  panel.querySelectorAll("[data-select]").forEach((button) => {
    button.addEventListener("click", () => selectStock(button.dataset.select));
  });
  panel.querySelectorAll(".candidate-actions button[data-action]").forEach((button) => {
    button.addEventListener("click", () => {
      const action = button.dataset.action;
      setCandidateAction(selected.ticker, actionValue === action ? "" : action);
    });
  });
}

function compareStocks(a, b) {
  let left = state.sortKey === "livePrice" ? getQuote(a.ticker)?.price : state.sortKey === "liveChange" ? getQuote(a.ticker)?.changePercent : a[state.sortKey];
  let right = state.sortKey === "livePrice" ? getQuote(b.ticker)?.price : state.sortKey === "liveChange" ? getQuote(b.ticker)?.changePercent : b[state.sortKey];
  if (state.sortKey === "chain_layer") {
    left = layerOrder[left];
    right = layerOrder[right];
  }
  if (left == null && right == null) return a.ticker.localeCompare(b.ticker);
  if (left == null) return 1;
  if (right == null) return -1;
  if (typeof left === "number" && typeof right === "number") return (left - right) * state.sortDirection;
  return String(left).localeCompare(String(right), "zh-CN") * state.sortDirection;
}

function renderMatrix(visibleStocks) {
  const body = document.getElementById("matrixBody");
  if (!visibleStocks.length) {
    body.innerHTML = `<tr><td colspan="11"><div class="empty-state">当前筛选没有匹配标的</div></td></tr>`;
    return;
  }
  body.innerHTML = [...visibleStocks].sort(compareStocks).map((stock) => {
    const statusClass = researchStatusClass(stock.status);
    const quote = getQuote(stock.ticker);
    return `<tr data-select="${stock.ticker}">
      <td class="ticker-cell">${displayTicker(stock.ticker)}</td>
      <td>${escapeHtml(stock.company)}</td>
      <td><span class="market-tag ${stock.market === "A股" ? "a-share" : "us-share"}">${escapeHtml(stock.market)}</span></td>
      <td><span class="layer-tag ${layerClasses[stock.chain_layer]}">${stock.chain_layer}</span></td>
      <td>${escapeHtml(stock.sector)}</td>
      <td class="price-cell">${quote ? formatPrice(quote.price, quote.currency) : "—"}</td>
      <td class="change-cell ${quote ? quoteClass(quote.changePercent) : "quote-flat"}">${quote ? formatPercent(quote.changePercent) : "—"}</td>
      <td>${escapeHtml(stock.role)}</td>
      <td>${escapeHtml(stock.key_focus)}</td>
      <td><span class="status-tag ${statusClass}">${stock.status}</span></td>
      <td class="relation-count">${getConnections(stock.ticker).length}</td>
    </tr>`;
  }).join("");
  body.querySelectorAll("tr[data-select]").forEach((row) => {
    row.addEventListener("click", () => {
      state.selected = row.dataset.select;
      activateView("graphView");
      renderAll();
    });
  });
}

function renderList(visibleStocks) {
  const container = document.getElementById("chainColumns");
  container.innerHTML = ["上游", "中游", "下游"].map((layer) => {
    const layerStocks = visibleStocks.filter((stock) => stock.chain_layer === layer);
    const extraSectors = [...new Set(layerStocks.map((stock) => stock.category))].filter((sector) => !sectorOrder.includes(sector));
    const sectors = [...sectorOrder, ...extraSectors].filter((sector) => layerStocks.some((stock) => stock.category === sector));
    return `<section class="chain-column">
      <header class="chain-header ${layerClasses[layer]}"><h2>${layer}</h2><span>${layerStocks.length} STOCKS</span></header>
      ${sectors.map((sector) => {
        const sectorStocks = layerStocks.filter((stock) => stock.category === sector).sort((a, b) => a.ticker.localeCompare(b.ticker));
        return `<section class="sector-section">
          <h3>${escapeHtml(sector)}<span>${sectorStocks.length}</span></h3>
          ${sectorStocks.map((stock) => {
            const quote = getQuote(stock.ticker);
            return `<button type="button" class="stock-row" data-select="${stock.ticker}">
              <strong>${displayTicker(stock.ticker)}</strong><div><p><span class="market-mini">${escapeHtml(stock.market)}</span>${escapeHtml(stock.role)}</p></div><span class="row-quote ${quote ? quoteClass(quote.changePercent) : "quote-flat"}">${quote ? formatPercent(quote.changePercent) : "—"}</span>
            </button>`;
          }).join("")}
        </section>`;
      }).join("") || `<div class="empty-state">当前层级无匹配标的</div>`}
    </section>`;
  }).join("");
  container.querySelectorAll("[data-select]").forEach((button) => {
    button.addEventListener("click", () => {
      state.selected = button.dataset.select;
      activateView("graphView");
      renderAll();
    });
  });
}

function policyZoneLabel(zone) {
  const labels = {
    low_pressure: "低压区",
    neutral: "中性区",
    high_pressure: "高压区",
    extreme_pressure: "极端压力"
  };
  return labels[zone] || zone || "待判断";
}

function policyStanceClass(stance) {
  if (["能下手", "偏强"].includes(stance)) return "positive";
  if (["等回踩", "谨慎"].includes(stance)) return "caution";
  return "watch";
}

function policyMappedStocks(categories = []) {
  const categorySet = new Set(categories);
  return stocks.filter((stock) => categorySet.has(stock.category) || categorySet.has(stock.sector));
}

function policyStatusMeta(status) {
  const values = {
    scheduled_snapshot: { label: "定时快照", className: "partial", note: "计划每小时更新，以实际数据时间为准" },
    live: { label: "动态更新", className: "live", note: "六项数据源均正常" },
    partial: { label: "部分降级", className: "partial", note: "部分指标使用最近快照" },
    fallback: { label: "快照模式", className: "fallback", note: "实时接口暂不可用" },
    demo_snapshot: { label: "示例快照", className: "fallback", note: "等待实时数据" }
  };
  return values[status] || values.partial;
}

function policyFreshnessMeta(freshness) {
  const values = {
    scheduled_snapshot: { label: "定时快照", className: "partial", note: "计划每小时更新，以实际数据时间为准" },
    live: { label: "交易时点", className: "live" },
    current: { label: "源站最新", className: "current" },
    delayed: { label: "低频更新", className: "delayed" },
    stale: { label: "数据偏旧", className: "stale" },
    fallback: { label: "降级快照", className: "fallback" },
    unknown: { label: "待确认", className: "unknown" }
  };
  return values[freshness] || values.unknown;
}

function formatPolicyTime(value, withDate = true) {
  if (!value) return "时间未知";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("zh-CN", {
    hour12: false,
    month: withDate ? "2-digit" : undefined,
    day: withDate ? "2-digit" : undefined,
    hour: "2-digit",
    minute: "2-digit"
  });
}

function policyZoneExplanation(zone) {
  const values = {
    low_pressure: "市场和政治约束较弱，暂不能据此判断政策会软化。",
    neutral: "约束正在形成，但尚未构成明确的政策转向信号。",
    high_pressure: "多项约束已进入高位，应密切观察延期、豁免与谈判信号。",
    extreme_pressure: "市场与政治压力共振，但仍需政策行动确认，不能直接等同于退让。"
  };
  return values[zone] || "需要结合政策行动和事件时间线继续验证。";
}

function formatPolicyPercent(value, digits = 1, fallback = "积累中") {
  if (value === null || value === undefined || value === "") return fallback;
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return `${number >= 0 ? "+" : ""}${number.toFixed(digits)}%`;
}

function sortCrowdingRows(rows, mode) {
  const sorted = [...rows];
  if (mode === "earnings") {
    const rank = { company_specific_distribution: 0, company_specific_weakness: 1, mixed: 2, sector_driven: 3, relative_strength: 4 };
    return sorted.sort((left, right) => {
      const leftRank = rank[left.earningsWindow?.classification] ?? 5;
      const rightRank = rank[right.earningsWindow?.classification] ?? 5;
      if (leftRank !== rightRank) return leftRank - rightRank;
      return Number(left.earningsWindow?.day20?.excess ?? 999) - Number(right.earningsWindow?.day20?.excess ?? 999);
    });
  }
  if (mode === "lag") {
    const rank = { waiting_for_cut: 0, cut_after_price: 1, recovered_without_cut: 2, not_triggered: 3, unavailable: 4 };
    return sorted.sort((left, right) => {
      const leftRank = rank[left.downgradeLag?.status] ?? 5;
      const rightRank = rank[right.downgradeLag?.status] ?? 5;
      if (leftRank !== rightRank) return leftRank - rightRank;
      return Number(right.downgradeLag?.waitingDays || right.downgradeLag?.lagDays || 0)
        - Number(left.downgradeLag?.waitingDays || left.downgradeLag?.lagDays || 0);
    });
  }
  return sorted.sort((left, right) => Number(right.score || 0) - Number(left.score || 0));
}

function buildCrowdingTimeline(row) {
  const timeline = Array.isArray(row?.priceTimeline) ? row.priceTimeline.filter((item) => Number.isFinite(Number(item.priceIndex))) : [];
  if (timeline.length < 2) return `<div class="policy-timeline-empty">价格时间线暂不可用</div>`;
  const width = 960;
  const height = 270;
  const padding = { top: 28, right: 26, bottom: 35, left: 44 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const values = timeline.flatMap((item) => [Number(item.priceIndex), Number(item.sectorIndex)]).filter(Number.isFinite);
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const span = Math.max(8, maximum - minimum);
  const yMinimum = minimum - span * 0.12;
  const yMaximum = maximum + span * 0.12;
  const xAt = (index) => padding.left + (index / Math.max(1, timeline.length - 1)) * chartWidth;
  const yAt = (value) => padding.top + ((yMaximum - value) / Math.max(1, yMaximum - yMinimum)) * chartHeight;
  const pathFor = (key) => timeline.map((item, index) => {
    const value = Number(item[key]);
    if (!Number.isFinite(value)) return "";
    return `${index === 0 ? "M" : "L"}${xAt(index).toFixed(1)},${yAt(value).toFixed(1)}`;
  }).join(" ");
  const indexForDate = (date) => {
    const exact = timeline.findIndex((item) => item.date >= String(date || "").slice(0, 10));
    return exact >= 0 ? exact : timeline.length - 1;
  };
  const targetEvents = (row.targetEvents || []).filter((event) => {
    const date = String(event.date || "").slice(0, 10);
    return date >= timeline[0].date && date <= timeline[timeline.length - 1].date && ["target_raise", "target_cut"].includes(event.type);
  });
  const eventLines = targetEvents.map((event) => {
    const x = xAt(indexForDate(event.date));
    const isCut = event.type === "target_cut";
    return `<g class="${isCut ? "is-cut" : "is-raise"}"><line x1="${x}" y1="${padding.top}" x2="${x}" y2="${height - padding.bottom}"/><circle cx="${x}" cy="${padding.top + 6}" r="4"><title>${escapeHtml(event.firm || "机构")} · ${escapeHtml(event.label || "目标价调整")}</title></circle></g>`;
  }).join("");
  const earningsDate = row.earningsWindow?.eventDate;
  const earningsLine = earningsDate && earningsDate >= timeline[0].date && earningsDate <= timeline[timeline.length - 1].date
    ? `<g class="is-earnings"><line x1="${xAt(indexForDate(earningsDate))}" y1="${padding.top}" x2="${xAt(indexForDate(earningsDate))}" y2="${height - padding.bottom}"/><text x="${xAt(indexForDate(earningsDate)) + 5}" y="${padding.top + 14}">财报</text></g>`
    : "";
  const breakDate = row.downgradeLag?.breakDate;
  const breakLine = breakDate && breakDate >= timeline[0].date && breakDate <= timeline[timeline.length - 1].date
    ? `<g class="is-break"><line x1="${xAt(indexForDate(breakDate))}" y1="${padding.top}" x2="${xAt(indexForDate(breakDate))}" y2="${height - padding.bottom}"/><text x="${xAt(indexForDate(breakDate)) + 5}" y="${height - padding.bottom - 8}">-15%</text></g>`
    : "";
  const grid = [0, 0.5, 1].map((ratio) => {
    const value = yMaximum - (yMaximum - yMinimum) * ratio;
    const y = padding.top + chartHeight * ratio;
    return `<g class="policy-timeline-grid"><line x1="${padding.left}" y1="${y}" x2="${width - padding.right}" y2="${y}"/><text x="4" y="${y + 3}">${value.toFixed(0)}</text></g>`;
  }).join("");
  return `<div class="policy-timeline-chart">
    <div class="policy-timeline-legend"><span class="stock">个股</span><span class="sector">SOXX</span><span class="raise">目标价上调</span><span class="cut">目标价下调</span></div>
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(row.ticker || "个股")}相对SOXX、财报和目标价调整时间线">
      ${grid}<path class="sector-line" d="${pathFor("sectorIndex")}"/><path class="stock-line" d="${pathFor("priceIndex")}"/>
      ${eventLines}${earningsLine}${breakLine}
      <text class="axis-date" x="${padding.left}" y="${height - 8}">${escapeHtml(timeline[0].date.slice(5))}</text>
      <text class="axis-date" text-anchor="end" x="${width - padding.right}" y="${height - 8}">${escapeHtml(timeline[timeline.length - 1].date.slice(5))}</text>
    </svg>
  </div>`;
}

function renderPolicy() {
  const panel = document.getElementById("policyPanel");
  if (!panel) return;
  if (!policyState.loaded) {
    panel.innerHTML = `<div class="empty-state">政策压力数据加载中</div>`;
    return;
  }
  if (!policyState.data) {
    panel.innerHTML = `<div class="empty-state">${escapeHtml(policyState.error || "政策压力数据暂不可用")}<br><button id="policyRetry" class="policy-empty-retry" type="button">重新加载</button></div>`;
    panel.querySelector("#policyRetry")?.addEventListener("click", () => loadPolicyData(true));
    return;
  }

  const payload = policyState.data;
  const index = payload.index || {};
  const drivers = Array.isArray(payload.drivers) ? payload.drivers : [];
  const mappings = Array.isArray(payload.industryMapping) ? payload.industryMapping : [];
  const history = Array.isArray(payload.history) ? payload.history : [];
  const pressureBreakdown = Array.isArray(payload.pressureBreakdown) ? payload.pressureBreakdown : [];
  const policyEvents = Array.isArray(payload.policyEvents) ? payload.policyEvents : [];
  const crowding = payload.institutionalCrowding || {};
  const crowdingRows = Array.isArray(crowding.rows) ? crowding.rows : [];
  const crowdingDisplayRows = sortCrowdingRows(crowdingRows, policyState.crowdingMode);
  const selectedCrowdingRow = crowdingRows.find((row) => row.ticker === policyState.crowdingTicker)
    || crowdingDisplayRows[0]
    || null;
  if (selectedCrowdingRow) policyState.crowdingTicker = selectedCrowdingRow.ticker;
  const scenarioMatrix = payload.scenarioMatrix || {};
  const scenarios = Array.isArray(scenarioMatrix.scenarios) ? scenarioMatrix.scenarios : [];
  const sourceHealth = Array.isArray(payload.sourceHealth) ? payload.sourceHealth : [];
  const statusMeta = policyStatusMeta(payload.status);
  const asOfText = formatPolicyTime(payload.asOf);
  const value = Number(index.value);
  const change = Number(index.change5d || 0);
  const historyMax = Math.max(100, ...history.map((item) => Number(item.value) || 0));
  const sortedDrivers = [...drivers].sort((left, right) => (
    Number(right.pressureScore || 0) * Number(right.weight || 0)
    - Number(left.pressureScore || 0) * Number(left.weight || 0)
  ));
  const topDrivers = sortedDrivers.slice(0, 3);
  const selectedCrowdingMetrics = selectedCrowdingRow?.metrics || {};
  const selectedExpectation = selectedCrowdingRow?.expectations?.primary || {};
  const selectedEps = selectedExpectation.eps || {};
  const selectedRevenue = selectedExpectation.revenue || {};
  const selectedEarningsWindow = selectedCrowdingRow?.earningsWindow || {};
  const selectedLag = selectedCrowdingRow?.downgradeLag || {};
  const selectedHistory = selectedCrowdingRow?.historyStatus || {};

  panel.innerHTML = `
    <section class="policy-live-bar">
      <div>
        <span class="policy-live-status ${statusMeta.className}"><i></i>${statusMeta.label}</span>
        <strong>${escapeHtml(payload.warning || statusMeta.note)}</strong>
        <span>计算于 ${escapeHtml(asOfText)}</span>
      </div>
      <div>
        <span>政策快照每小时更新 · 民调/通胀跟随源站</span>
        <button id="policyRefresh" type="button" ${policyState.loading ? "disabled" : ""}>
          <i data-lucide="refresh-cw" aria-hidden="true"></i>
          ${policyState.loading ? "更新中" : "获取最新快照"}
        </button>
      </div>
    </section>
    ${policyState.error ? `<div class="policy-fallback-notice">实时接口本次未完整返回，页面已自动使用最近有效数据。${escapeHtml(policyState.error)}</div>` : ""}
    <section class="policy-hero">
      <div class="policy-hero-copy">
        <div class="policy-kicker">TACO / TRUMP PRESSURE INDEX</div>
        <h2>政策能走多远，<br><em>市场正在投票。</em></h2>
        <p>把民调、利率、债券波动率、股市、VIX 与短期通胀预期，压缩成一个可追踪的政策压力信号。</p>
        <div class="policy-takeaway">
          <span>一句话解读</span>
          <strong>${escapeHtml(payload.summary || policyZoneExplanation(index.zone))}</strong>
        </div>
      </div>
      <div class="policy-score-card">
        <div class="policy-score-head"><span>当前政策压力</span><strong>${escapeHtml(policyZoneLabel(index.zone))}</strong></div>
        <div class="policy-score-value">${value.toFixed(1)}</div>
        <div class="policy-score-change ${change >= 0 ? "is-up" : "is-down"}">${change >= 0 ? "↗" : "↘"} 较上个周度观测 ${change >= 0 ? "+" : ""}${change.toFixed(1)}</div>
        <div class="policy-gauge"><i style="width:${clampValue(value, 0, 100)}%"></i></div>
        <div class="policy-gauge-labels"><span>0 低压</span><span>40 中性</span><span>60 高压</span><span>75 极端</span></div>
        <p>${escapeHtml(policyZoneExplanation(index.zone))}</p>
      </div>
    </section>

    <section class="policy-explain-grid">
      <article><span>最大压力来源</span><strong>${escapeHtml(topDrivers[0]?.name || "—")}</strong><p>贡献 ${((Number(topDrivers[0]?.pressureScore || 0) * Number(topDrivers[0]?.weight || 0))).toFixed(1)} 分</p></article>
      <article><span>压力是否升温</span><strong class="${change >= 0 ? "is-hot" : "is-cool"}">${change >= 0 ? "正在升温" : "正在缓和"}</strong><p>相对最近一个周度观测 ${change >= 0 ? "+" : ""}${change.toFixed(1)}</p></article>
      <article><span>下一步验证</span><strong>看行动，不只看表态</strong><p>延期、豁免、撤回或正式谈判进展才算政策软化确认。</p></article>
    </section>

    <section class="policy-section policy-overview-section">
      <div class="policy-section-head policy-section-head-compact">
        <div><span>DECISION OVERVIEW</span><h3>今天先看这三件事</h3></div>
        <p>先判断压力结构、当前情景和政策阶段，再进入单项数据研究。</p>
      </div>
      <div class="policy-overview-grid">
        <div class="policy-overview-card policy-pressure-compact">
          <header><span>四类压力</span><strong>结构比总分更重要</strong></header>
          ${pressureBreakdown.map((group) => `<div class="policy-pressure-row">
            <div><span>${escapeHtml(group.name || group.id)}</span><small>${escapeHtml(group.level || "")}</small></div>
            <div class="policy-pressure-track"><i style="width:${clampValue(Number(group.score || 0), 0, 100)}%"></i></div>
            <strong>${Number(group.score || 0).toFixed(0)}</strong>
          </div>`).join("") || `<p class="policy-overview-empty">压力分解暂未返回。</p>`}
        </div>
        <div class="policy-overview-card policy-overview-scenario">
          <header><span>当前情景</span><strong>${escapeHtml(scenarioMatrix.current?.title || "等待情景判断")}</strong></header>
          <p>${escapeHtml(scenarioMatrix.current?.action || "等待政策压力与机构拥挤信号形成交叉验证。")}</p>
          <div><span>压力 ${value.toFixed(0)}</span><span>拥挤 ${Number.isFinite(Number(crowding.aggregateScore)) ? Number(crowding.aggregateScore).toFixed(0) : "—"}</span></div>
        </div>
      </div>
      ${policyEvents.length ? `<div class="policy-event-ribbon" aria-label="政策事件阶段概览">
        <span>政策阶段</span>
        ${policyEvents.map((event) => `<div class="${escapeHtml(event.phase || "monitoring")}"><strong>${escapeHtml(event.name || "政策事件")}</strong><small>${escapeHtml(event.phaseLabel || "持续监测")}</small></div>`).join("")}
      </div>` : ""}
    </section>

    ${policyEvents.length ? `<details class="policy-disclosure policy-event-disclosure">
      <summary>
        <span><small>POLICY EVENT RADAR</small><strong>政策事件明细</strong></span>
        <em>${policyEvents.length} 类事件 · 查看新闻、阶段与股票映射</em>
      </summary>
      <div class="policy-disclosure-body">
        <div class="policy-disclosure-intro">新闻只负责定位阶段，不直接改变压力指数。正式文本、豁免清单和执行日期优先级更高。</div>
        <div class="policy-event-grid">
          ${policyEvents.map((event) => {
            const mappedStocks = policyMappedStocks(event.poolCategories || []);
            return `<article class="policy-event-card ${escapeHtml(event.phase || "monitoring")}">
              <div class="policy-event-head"><h4>${escapeHtml(event.name || "政策事件")}</h4><span>${escapeHtml(event.phaseLabel || "持续监测")}</span></div>
              <p>${escapeHtml(event.pressureInteraction || "")}</p>
              <div class="policy-event-news">
                ${(event.items || []).slice(0, 3).map((item) => {
                  const href = safeExternalHref(item.url || "");
                  return href ? `<a href="${escapeHtml(href)}" target="_blank" rel="noreferrer"><strong>${escapeHtml(item.title || "")}</strong><span>${escapeHtml(item.source || "")} · ${escapeHtml(formatPolicyTime(item.publishedAt))}</span></a>` : "";
                }).join("") || "<span>暂无可用事件条目</span>"}
              </div>
              <div class="policy-ticker-list">
                ${mappedStocks.slice(0, 6).map((stock) => `<button type="button" data-policy-ticker="${escapeHtml(stock.ticker)}">${escapeHtml(displayTicker(stock.ticker))}</button>`).join("") || "<span>暂无直接映射</span>"}
              </div>
            </article>`;
          }).join("")}
        </div>
      </div>
    </details>` : ""}

    <section class="policy-section policy-crowding-section">
      <div class="policy-section-head">
        <div><span>INSTITUTIONAL CROWDING / CONTRARIAN RISK</span><h3>机构一致性反向信号</h3></div>
        <p>评级越一致、目标价越乐观，却同时出现价格走弱和下调滞后，派发风险越高；高目标价单独不构成顶部。</p>
      </div>
      <div class="policy-crowding-summary">
        <div><span>覆盖</span><strong>${Number(crowding.coverage?.received || 0)} / ${Number(crowding.coverage?.requested || 0)}</strong></div>
        <div><span>综合拥挤度</span><strong>${Number.isFinite(Number(crowding.aggregateScore)) ? Number(crowding.aggregateScore).toFixed(1) : "—"}</strong></div>
        <div><span>高风险标的</span><strong>${Number(crowding.highRiskCount || 0)}</strong></div>
        <p>${escapeHtml(crowding.boundary || "机构拥挤度是反向风险提示，不是顶部确认。")}</p>
      </div>
      <div class="policy-crowding-toolbar" role="tablist" aria-label="机构反向信号视图">
        <button type="button" role="tab" aria-selected="${policyState.crowdingMode === "risk" ? "true" : "false"}" data-crowding-mode="risk" class="${policyState.crowdingMode === "risk" ? "active" : ""}">当前风险排行</button>
        <button type="button" role="tab" aria-selected="${policyState.crowdingMode === "earnings" ? "true" : "false"}" data-crowding-mode="earnings" class="${policyState.crowdingMode === "earnings" ? "active" : ""}">财报后派发</button>
        <button type="button" role="tab" aria-selected="${policyState.crowdingMode === "lag" ? "true" : "false"}" data-crowding-mode="lag" class="${policyState.crowdingMode === "lag" ? "active" : ""}">机构补降</button>
        <span>SOXX行业基准 · ${Number(crowding.history?.snapshotCount || 0)}个每日快照</span>
      </div>
      ${crowdingRows.length ? `<div class="policy-crowding-workbench">
        <div class="policy-crowding-rank" role="list" aria-label="机构反向信号排行榜">
          <header><span>优先级</span><strong>${policyState.crowdingMode === "earnings" ? "财报后相对 SOXX" : policyState.crowdingMode === "lag" ? "股价先跌、机构后降" : "多证据风险分"}</strong></header>
          ${crowdingDisplayRows.map((row, rankIndex) => {
            const ticker = String(row.ticker || "");
            const metrics = row.metrics || {};
            const eventExcess = row.earningsWindow?.day20?.excess;
            const modeMetric = policyState.crowdingMode === "earnings"
              ? `20日超额 ${formatPolicyPercent(eventExcess, 1, "待财报")}`
              : policyState.crowdingMode === "lag"
                ? escapeHtml(row.downgradeLag?.label || "下调序列积累中")
                : `${Number(metrics.bullishShare || 0).toFixed(0)}% 买入 · ${Number(metrics.targetRaises45d || 0)}升/${Number(metrics.targetCuts45d || 0)}降`;
            return `<button type="button" role="listitem" class="policy-rank-row ${ticker === selectedCrowdingRow?.ticker ? "is-selected" : ""}" data-crowding-detail="${escapeHtml(ticker)}" aria-pressed="${ticker === selectedCrowdingRow?.ticker ? "true" : "false"}">
              <b>${String(rankIndex + 1).padStart(2, "0")}</b>
              <span><strong>${escapeHtml(ticker)}</strong><small>${escapeHtml(row.company || "")}</small></span>
              <span><em>${Number(row.score || 0).toFixed(0)}</em><small>${escapeHtml(row.label || "观察")}</small></span>
              <small>${modeMetric}</small>
            </button>`;
          }).join("")}
        </div>
        ${selectedCrowdingRow ? `<article class="policy-crowding-focus ${escapeHtml(selectedCrowdingRow.zone || "balanced")}">
          <header>
            <div><span>当前焦点</span><h4>${escapeHtml(selectedCrowdingRow.ticker)} <small>${escapeHtml(selectedCrowdingRow.company || "")}</small></h4></div>
            <b>${Number(selectedCrowdingRow.score || 0).toFixed(0)} · ${escapeHtml(selectedCrowdingRow.label || "观察")}</b>
          </header>
          <p>${escapeHtml(selectedCrowdingRow.expectationDivergence?.label || "等待预期修正与价格信号形成交叉验证")}</p>
          <div class="policy-focus-metrics">
            <div><span>EPS 30日</span><strong class="${Number(selectedEps.change30d) < 0 ? "negative" : "positive"}">${formatPolicyPercent(selectedEps.change30d)}</strong></div>
            <div><span>财报后20日超额</span><strong>${formatPolicyPercent(selectedEarningsWindow.day20?.excess, 1, "待财报")}</strong></div>
            <div><span>机构补降</span><strong>${escapeHtml(selectedLag.label || "积累中")}</strong></div>
            <div><span>45日目标价</span><strong>${Number(selectedCrowdingMetrics.targetRaises45d || 0)}升 / ${Number(selectedCrowdingMetrics.targetCuts45d || 0)}降</strong></div>
          </div>
          <div class="policy-crowding-evidence">
            ${(selectedCrowdingRow.evidence || []).slice(0, 4).map((item) => `<span>${escapeHtml(item)}</span>`).join("") || "<span>尚未形成多证据共振</span>"}
          </div>
          <div class="policy-focus-actions">
            <button type="button" class="primary" data-crowding-expand aria-expanded="${policyState.crowdingExpanded ? "true" : "false"}">${policyState.crowdingExpanded ? "收起完整分析" : "展开完整分析"}</button>
            ${stockByTicker.has(selectedCrowdingRow.ticker) ? `<button type="button" data-policy-ticker="${escapeHtml(selectedCrowdingRow.ticker)}">查看产业链位置</button>` : ""}
          </div>
        </article>` : ""}
      </div>` : `<div class="policy-crowding-empty">分析师覆盖暂时不可用，本模块不使用虚构数据填补。</div>`}
      ${selectedCrowdingRow && policyState.crowdingExpanded ? `<section class="policy-crowding-detail" id="policyCrowdingDetail">
        <header>
          <div><span>POINT-IN-TIME DIVERGENCE</span><h4>${escapeHtml(selectedCrowdingRow.ticker)} · ${escapeHtml(selectedCrowdingRow.company || "")}</h4></div>
          <div><strong>${escapeHtml(selectedCrowdingRow.expectationDivergence?.label || "等待预期修正确认")}</strong><span>${escapeHtml(selectedLag.label || "下调滞后积累中")}</span></div>
        </header>
        <div class="policy-expectation-grid">
          <article><span>EPS 30日修正</span><strong class="${Number(selectedEps.change30d) < 0 ? "negative" : "positive"}">${formatPolicyPercent(selectedEps.change30d)}</strong><small>${selectedEps.current != null ? `当前 ${Number(selectedEps.current).toFixed(2)}` : "源站未提供"}</small></article>
          <article><span>EPS 60日修正</span><strong class="${Number(selectedEps.change60d) < 0 ? "negative" : "positive"}">${formatPolicyPercent(selectedEps.change60d)}</strong><small>${selectedEps.value60dAgo != null ? `60日前 ${Number(selectedEps.value60dAgo).toFixed(2)}` : "源站未提供"}</small></article>
          <article><span>收入 30日修正</span><strong class="${Number(selectedRevenue.change30d) < 0 ? "negative" : "positive"}">${formatPolicyPercent(selectedRevenue.change30d)}</strong><small>${selectedHistory.revenue30dReady ? "每日快照计算" : "历史快照积累中"}</small></article>
          <article><span>收入 60日修正</span><strong class="${Number(selectedRevenue.change60d) < 0 ? "negative" : "positive"}">${formatPolicyPercent(selectedRevenue.change60d)}</strong><small>${selectedHistory.revenue60dReady ? "每日快照计算" : "历史快照积累中"}</small></article>
          <article><span>目标价中位数</span><strong>${selectedCrowdingMetrics.targetMedian != null ? Number(selectedCrowdingMetrics.targetMedian).toFixed(2) : "—"}</strong><small>${Number(selectedCrowdingMetrics.targetRaises45d || 0)}升 / ${Number(selectedCrowdingMetrics.targetCuts45d || 0)}降</small></article>
          <article><span>风险分7日变化</span><strong>${selectedCrowdingRow.scoreChange7d == null ? "积累中" : `${Number(selectedCrowdingRow.scoreChange7d) >= 0 ? "+" : ""}${Number(selectedCrowdingRow.scoreChange7d).toFixed(1)}`}</strong><small>${Number(selectedHistory.points || 0)}个历史时点</small></article>
        </div>
        <div class="policy-earnings-window">
          <div><span>最近财报窗口</span><strong>${escapeHtml(selectedEarningsWindow.label || "尚未形成")}</strong><p>${escapeHtml(selectedEarningsWindow.explanation || selectedEarningsWindow.reason || "等待财报后价格窗口")}</p></div>
          ${[1, 5, 20].map((days) => {
            const window = selectedEarningsWindow[`day${days}`] || {};
            return `<article><span>财报后 ${days} 日</span><strong>${formatPolicyPercent(window.stock, 1, "—")}</strong><small>SOXX ${formatPolicyPercent(window.sector, 1, "—")} · 超额 ${formatPolicyPercent(window.excess, 1, "—")}</small></article>`;
          }).join("")}
          <article><span>反应日成交量</span><strong>${selectedEarningsWindow.reactionVolumeRatio ? `${Number(selectedEarningsWindow.reactionVolumeRatio).toFixed(2)}×` : "—"}</strong><small>相对财报前20日均量</small></article>
        </div>
        ${buildCrowdingTimeline(selectedCrowdingRow)}
        <footer><span>每日快照保存风险分、目标价中位数、EPS与收入一致预期；目标价调整事件与价格曲线用于检验“股价先跌、机构后降”。</span><strong>${escapeHtml(selectedLag.label || "等待形成下调滞后序列")}</strong></footer>
      </section>` : ""}
      <details class="policy-crowding-method">
        <summary>模型判定边界</summary>
        <p>${escapeHtml(crowding.method || payload.method?.crowdingModel || "至少两项证据同时成立才提示高风险。")}</p>
      </details>
    </section>

    ${scenarioMatrix.current ? `<details class="policy-disclosure">
      <summary>
        <span><small>DECISION MATRIX</small><strong>政策压力 × 机构拥挤</strong></span>
        <em>当前：${escapeHtml(scenarioMatrix.current.title || "等待判断")} · 查看四象限</em>
      </summary>
      <div class="policy-disclosure-body">
        <div class="policy-disclosure-intro">把“政策会不会软化”和“资产是否已经被过度推销”分开判断。</div>
        <div class="policy-current-scenario"><span>当前情景</span><strong>${escapeHtml(scenarioMatrix.current.title || "")}</strong><p>${escapeHtml(scenarioMatrix.current.action || "")}</p></div>
        <div class="policy-scenario-grid">
          ${scenarios.map((scenario) => `<article class="${scenario.id === scenarioMatrix.current.id ? "active" : ""}"><span>${escapeHtml(scenario.policy || "")} × ${escapeHtml(scenario.crowding || "")}</span><strong>${escapeHtml(scenario.title || "")}</strong><p>${escapeHtml(scenario.action || "")}</p></article>`).join("")}
        </div>
      </div>
    </details>` : ""}

    <details class="policy-disclosure">
      <summary>
        <span><small>SIX PRESSURE DRIVERS</small><strong>六项压力驱动</strong></span>
        <em>${drivers.length} 项数据 · 查看数值、权重、贡献与新鲜度</em>
      </summary>
      <div class="policy-disclosure-body">
        <div class="policy-disclosure-intro">先看真实数值，再看压力分与权重贡献。不同发布频率分开标注，避免把民调和通胀误认为盘中数据。</div>
        <div class="policy-driver-grid">
        ${drivers.map((driver) => `
          <article class="policy-driver-card">
            <div class="policy-driver-head">
              <div><span>${escapeHtml(driver.nameZh || driver.name || driver.id)}</span><small>权重 ${Math.round(Number(driver.weight || 0) * 100)}%</small></div>
              <span class="policy-freshness ${policyFreshnessMeta(driver.freshness).className}">${policyFreshnessMeta(driver.freshness).label}</span>
            </div>
            <div class="policy-driver-value-row">
              <strong>${escapeHtml(driver.value || Number(driver.pressureScore || 0).toFixed(0))}</strong>
              <span>${escapeHtml(driver.changeLabel || "等待下一次数据更新")}</span>
            </div>
            <div class="policy-driver-score">
              <span>压力分 <strong>${Number(driver.pressureScore || 0).toFixed(0)}</strong></span>
              <span>贡献 ${(Number(driver.pressureScore || 0) * Number(driver.weight || 0)).toFixed(1)}</span>
            </div>
            <div class="policy-driver-bar"><i style="width:${clampValue(Number(driver.pressureScore || 0), 0, 100)}%"></i></div>
            <p>${escapeHtml(driver.interpretation || driver.direction || "")}</p>
            <footer>
              <span>${escapeHtml(driver.sourceName || "来源待补充")}</span>
              <time>${escapeHtml(formatPolicyTime(driver.updatedAt))}</time>
            </footer>
          </article>
        `).join("")}
        </div>
      </div>
    </details>

    ${history.length ? `<details class="policy-disclosure">
      <summary>
        <span><small>PRESSURE TREND</small><strong>近期压力趋势</strong></span>
        <em>${history.length} 个观测点 · 最近 ${Number(history.at(-1)?.value || value).toFixed(1)}</em>
      </summary>
      <div class="policy-disclosure-body">
        <div class="policy-disclosure-intro">历史序列用于观察压力方向，不代表政策一定转向。</div>
        <div class="policy-history-chart">
          ${history.map((item) => `<div class="policy-history-column" title="${escapeHtml(item.date || "")} · ${Number(item.value || 0).toFixed(1)}"><strong>${Number(item.value || 0).toFixed(1)}</strong><i style="height:${(Number(item.value || 0) / historyMax) * 100}%"></i><span>${escapeHtml(item.label || item.date || "")}</span></div>`).join("")}
        </div>
      </div>
    </details>` : ""}

    <details class="policy-disclosure">
      <summary>
        <span><small>STOCK POOL TRANSMISSION</small><strong>对当前股票池的映射</strong></span>
        <em>${mappings.length} 个方向 · 查看行业传导与关联标的</em>
      </summary>
      <div class="policy-disclosure-body">
        <div class="policy-disclosure-intro">只引用指数与行业传导；公司是否值得买，仍由基本面和行情位置决定。</div>
        <div class="policy-mapping-grid">
        ${mappings.map((mapping) => {
          const mappedStocks = policyMappedStocks(mapping.poolCategories || []);
          return `<article class="policy-mapping-card">
            <div class="policy-mapping-title"><h4>${escapeHtml(mapping.sector || "行业映射")}</h4><span class="${policyStanceClass(mapping.stance)}">${escapeHtml(mapping.stance || "观察")}</span></div>
            ${mapping.signal ? `<div class="policy-mapping-signal">${escapeHtml(mapping.signal)}</div>` : ""}
            ${(mapping.policyOverlay || mapping.crowdingOverlay) ? `<div class="policy-mapping-overlays"><span>${escapeHtml(mapping.policyOverlay || "")}</span><span>${escapeHtml(mapping.crowdingOverlay || "")}</span></div>` : ""}
            <p>${escapeHtml(mapping.text || "")}</p>
            <div class="policy-mapping-count"><strong>${mappedStocks.length}</strong><span>只关联股票池标的</span></div>
            <div class="policy-ticker-list">
              ${mappedStocks.slice(0, 8).map((stock) => `<button type="button" data-policy-ticker="${escapeHtml(stock.ticker)}">${escapeHtml(displayTicker(stock.ticker))}</button>`).join("") || "<span>暂无直接映射</span>"}
            </div>
          </article>`;
        }).join("")}
        </div>
      </div>
    </details>

    ${sourceHealth.length ? `<details class="policy-source-ledger">
      <summary><span>数据来源与新鲜度</span><strong>${sourceHealth.filter((item) => ["live", "current"].includes(item.freshness)).length} / ${sourceHealth.length} 项处于正常更新状态</strong></summary>
      <div>
        ${sourceHealth.map((source) => {
          const fresh = policyFreshnessMeta(source.freshness);
          const href = safeExternalHref(source.sourceUrl || "");
          return `<article>
            <span class="policy-freshness ${fresh.className}">${fresh.label}</span>
            <div><strong>${escapeHtml(source.name || source.id)}</strong><p>${escapeHtml(source.sourceName || "")}</p></div>
            <time>${escapeHtml(formatPolicyTime(source.updatedAt))}</time>
            ${href ? `<a href="${escapeHtml(href)}" target="_blank" rel="noreferrer">来源 ↗</a>` : ""}
          </article>`;
        }).join("")}
      </div>
    </details>` : ""}

    <details class="policy-method-note">
      <summary><span>方法边界</span><strong>压力指数不是“退让预测器”</strong></summary>
      <p>${escapeHtml(payload.method?.weights || "民调25% / 标普20% / 美债15% / MOVE15% / VIX15% / CPI Nowcast10%")}。高分只表示政治与市场约束更强；本模块不构成投资建议。</p>
    </details>
  `;

  panel.querySelector("#policyRefresh")?.addEventListener("click", () => loadPolicyData(true));
  panel.querySelectorAll("[data-crowding-mode]").forEach((button) => {
    button.addEventListener("click", () => {
      policyState.crowdingMode = button.dataset.crowdingMode;
      const nextRows = sortCrowdingRows(crowdingRows, policyState.crowdingMode);
      policyState.crowdingTicker = nextRows[0]?.ticker || policyState.crowdingTicker;
      policyState.crowdingExpanded = false;
      renderPolicy();
    });
  });
  panel.querySelectorAll("[data-crowding-detail]").forEach((button) => {
    button.addEventListener("click", () => {
      policyState.crowdingTicker = button.dataset.crowdingDetail;
      policyState.crowdingExpanded = false;
      renderPolicy();
      panel.querySelector(".policy-crowding-focus")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
  });
  panel.querySelector("[data-crowding-expand]")?.addEventListener("click", () => {
    policyState.crowdingExpanded = !policyState.crowdingExpanded;
    renderPolicy();
    const target = policyState.crowdingExpanded
      ? panel.querySelector("#policyCrowdingDetail")
      : panel.querySelector(".policy-crowding-focus");
    target?.scrollIntoView({ behavior: "smooth", block: "start" });
  });
  panel.querySelectorAll("[data-policy-ticker]").forEach((button) => {
    button.addEventListener("click", () => {
      const ticker = button.dataset.policyTicker;
      if (!stockByTicker.has(ticker)) return;
      state.selected = ticker;
      state.query = "";
      state.market = "全部";
      state.layer = "全部";
      state.sector = "全部";
      state.status = "全部";
      document.getElementById("searchInput").value = "";
      renderAll();
      activateView("graphView");
    });
  });
  if (window.lucide) window.lucide.createIcons();
}

function candidateActionLabel(action) {
  const labels = {
    watch: "已加入观察",
    promote: "入池候选",
    ignore: "已忽略",
    research: "研究卡"
  };
  return labels[action] || "未处理";
}

function candidateActionClass(action) {
  if (action === "promote") return "promote";
  if (action === "ignore") return "ignore";
  if (action === "research") return "research";
  if (action === "watch") return "watch";
  return "";
}

function getCandidateActionValue(ticker) {
  const value = getCandidateAction(ticker);
  return typeof value === "string" ? value : value?.action || "";
}

function getCandidatesForTicker(ticker) {
  return discoveryState.candidates.filter((candidate) => candidate.ticker === ticker);
}

function getSignalsForTicker(ticker, limit = 6) {
  return discoveryState.signals
    .filter((signal) => [...signal.mappedTickers, ...signal.mappedAShares, ...signal.tickersMentioned].includes(ticker))
    .slice(0, limit);
}

function getPapersForTicker(ticker, limit = 6) {
  return discoveryState.papers
    .filter((paper) => [...paper.mappedTickers, ...paper.mappedAShares].includes(ticker))
    .slice(0, limit);
}

function getMappingTier(stock) {
  const evidence = `${stock.evidence_level || ""} ${stock.source || ""} ${stock.status || ""}`.toLowerCase();
  if (stock.market !== "A股") return null;
  if (evidence.includes("financial-confirmed") && !evidence.includes("proxy")) return { key: "confirmed", ...mappingTierMeta.confirmed };
  if (evidence.includes("product-confirmed")) return { key: "confirmed", ...mappingTierMeta.confirmed };
  if (evidence.includes("financial-confirmed") && evidence.includes("proxy")) return { key: "theme", ...mappingTierMeta.theme };
  if (evidence.includes("proxy")) return { key: "proxy", ...mappingTierMeta.proxy };
  if (evidence.includes("weak") || evidence.includes("mixed")) return { key: "risk", ...mappingTierMeta.risk };
  return { key: "theme", ...mappingTierMeta.theme };
}

function getTradePosition(stock, quote) {
  const position = stock.market_state || "";
  if (position.includes("过热") || position.includes("高位") || position.includes("处年内高点")) return "偏拥挤，优先等回踩";
  if (position.includes("回调") || position.includes("距高点") || position.includes("偏弱")) return "回撤区间，适合复核基本面";
  if (quote && Number.isFinite(quote.changePercent)) {
    if (quote.changePercent > 4) return "短线偏强，注意追高";
    if (quote.changePercent < -4) return "短线偏弱，确认是否基本面破坏";
    return "日内位置温和";
  }
  return "缺少行情，按中性处理";
}

function getDecisionStatus(stock) {
  const action = getCandidateActionValue(stock.ticker);
  if (action) return candidateActionLabel(action);
  const candidate = getCandidatesForTicker(stock.ticker)[0];
  if (candidate) return discoveryRecommendationLabel(candidate.recommendation);
  if (stock.status.includes("过热") || stock.status.includes("高估值")) return "等回踩";
  if (stock.status.includes("核心") || stock.status.includes("正式")) return "重点跟踪";
  return stock.status || "待评级";
}

function renderEvidenceList(items, type) {
  if (!items.length) return `<div class="empty-card compact">暂无${type}证据</div>`;
  return items.map((item) => {
    const href = safeExternalHref(item.sourceUrl || item.absUrl || "");
    const title = item.title || item.sourceName || item.arxivId || "未命名信号";
    const meta = item.date || item.published || item.sourceType || "";
    return `<article class="evidence-item">
      <div>${href ? `<a href="${escapeHtml(href)}" target="_blank" rel="noreferrer">${escapeHtml(title)}</a>` : `<strong>${escapeHtml(title)}</strong>`}</div>
      <span>${escapeHtml(meta)}${item.confidence ? ` · 置信 ${Math.round(item.confidence)}` : item.score ? ` · 分数 ${Math.round(item.score)}` : ""}</span>
    </article>`;
  }).join("");
}

function discoveryRecommendationLabel(value) {
  const labels = {
    propose_add: "建议入池",
    observe: "观察候选",
    already_in_pool: "池内强化",
    reject: "暂不处理"
  };
  return labels[value] || value || "待判断";
}

function discoveryPresenceLabel(value) {
  const labels = {
    online_pool: "已在股票池",
    current_pool: "已在当前池",
    mapped_pool: "映射池",
    out_of_pool: "池外候选",
    not_in_pool: "池外候选"
  };
  return labels[value] || value || "未标记";
}

function discoveryScoreClass(score) {
  if (score >= 76) return "high";
  if (score >= 62) return "medium";
  return "low";
}

function truncateText(value, length = 220) {
  const text = String(value || "").trim();
  if (text.length <= length) return text;
  return `${text.slice(0, length)}…`;
}

function safeExternalHref(value) {
  try {
    const url = new URL(value, window.location.href);
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}

function renderThemeChips(value, limit = 4) {
  const themes = splitList(value).slice(0, limit);
  if (!themes.length) return "";
  return `<div class="discovery-tags">${themes.map((theme) => `<span>${escapeHtml(theme)}</span>`).join("")}</div>`;
}

function renderCandidateDossier(candidate) {
  return `<div class="mini-research-card">
    <div><span>研究假设</span><p>${escapeHtml(truncateText(candidate.whyNow || candidate.theme || "由主动发现信号触发，需继续核实业务纯度。", 150))}</p></div>
    <div><span>证据数量</span><p>${candidate.supportingSignals.length} 条信号 · ${candidate.supportingPapers.length} 篇论文 · 总分 ${Math.round(candidate.totalScore)}</p></div>
    <div><span>下一步</span><p>${candidate.poolPresence === "not_in_pool" || candidate.poolPresence === "out_of_pool" ? "先核实收入敞口、客户/产品证据和估值位置，再决定是否入正式池。" : "检查新信号是否强化原有入池逻辑，避免只因主题热度重复加权。"}</p></div>
  </div>`;
}

function getDiscoveryQuote(candidate) {
  const quote = getQuote(candidate.ticker);
  if (quote) return quote;
  return {
    price: candidate.price,
    changePercent: candidate.changePercent,
    currency: candidate.market === "A股" ? "CNY" : "USD"
  };
}

function renderDiscoveryCandidateCard(candidate, compact = false) {
  const knownStock = stockByTicker.get(candidate.ticker);
  const market = candidate.market || knownStock?.market || "—";
  const chainLayer = candidate.chainLayer || knownStock?.chain_layer || "—";
  const quote = getDiscoveryQuote(candidate);
  const hasQuote = Number.isFinite(quote.price) || Number.isFinite(quote.changePercent);
  const actionValue = getCandidateActionValue(candidate.ticker);
  const actionStatus = candidateActionLabel(actionValue);
  const viewAction = knownStock
    ? `<button type="button" class="discovery-action" data-select="${escapeHtml(candidate.ticker)}">在图谱中查看</button>`
    : `<span class="discovery-action is-muted">未入正式池</span>`;
  const supporting = [
    candidate.supportingSignals.length ? `${candidate.supportingSignals.length} 条信号` : "",
    candidate.supportingPapers.length ? `${candidate.supportingPapers.length} 篇论文` : ""
  ].filter(Boolean).join(" · ");
  return `<article class="discovery-card ${compact ? "compact" : ""}">
    <div class="discovery-card-top">
      <div>
        <div class="discovery-ticker">${displayTicker(candidate.ticker)}<span>${escapeHtml(market)}</span></div>
        <h4>${escapeHtml(candidate.company || candidate.ticker)}</h4>
      </div>
      <span class="score-pill ${discoveryScoreClass(candidate.totalScore)}">${Math.round(candidate.totalScore)}</span>
    </div>
    <div class="discovery-meta-line">
      <span>${escapeHtml(discoveryRecommendationLabel(candidate.recommendation))}</span>
      <span>${escapeHtml(discoveryPresenceLabel(candidate.poolPresence))}</span>
      <span>${escapeHtml(chainLayer)}</span>
      <span class="candidate-action-state ${candidateActionClass(actionValue)}">${escapeHtml(actionStatus)}</span>
    </div>
    ${renderThemeChips(candidate.theme, compact ? 2 : 4)}
    <p>${escapeHtml(truncateText(candidate.whyNow || candidate.notes || "暂无摘要", compact ? 110 : 230))}</p>
    <div class="discovery-card-foot">
      <span class="discovery-quote ${quoteClass(quote.changePercent)}">${hasQuote ? `${formatPrice(quote.price, quote.currency)} / ${formatPercent(quote.changePercent)}` : "行情待同步"}</span>
      ${supporting ? `<span>${escapeHtml(supporting)}</span>` : ""}
      ${candidate.mappedUs ? `<span>映射 ${escapeHtml(candidate.mappedUs)}</span>` : ""}
      ${viewAction}
    </div>
    <div class="candidate-actions" data-ticker="${escapeHtml(candidate.ticker)}">
      <button type="button" data-action="watch" class="${actionValue === "watch" ? "is-active" : ""}">观察</button>
      <button type="button" data-action="promote" class="${actionValue === "promote" ? "is-active" : ""}">入池候选</button>
      <button type="button" data-action="ignore" class="${actionValue === "ignore" ? "is-active" : ""}">忽略</button>
      <button type="button" data-action="research" class="${actionValue === "research" ? "is-active" : ""}">研究卡</button>
    </div>
    ${actionValue === "research" ? renderCandidateDossier(candidate) : ""}
  </article>`;
}

function renderDiscoveryPaperItem(paper) {
  const href = safeExternalHref(paper.absUrl);
  const mapped = [...paper.mappedTickers.slice(0, 5), ...paper.mappedAShares.slice(0, 4)].slice(0, 7);
  return `<article class="discovery-list-item">
    <div class="discovery-list-title">
      ${href ? `<a href="${escapeHtml(href)}" target="_blank" rel="noreferrer">${escapeHtml(paper.title || paper.arxivId)}</a>` : `<strong>${escapeHtml(paper.title || paper.arxivId)}</strong>`}
      <span>${Math.round(paper.score)}</span>
    </div>
    <p>${escapeHtml(truncateText(paper.readthrough || paper.mappedThemes || paper.topic, 180))}</p>
    <div class="discovery-mini-tags">
      <span>${escapeHtml(paper.published || "日期未知")}</span>
      <span>${escapeHtml(paper.topic || "AI论文")}</span>
      ${mapped.map((ticker) => `<span>${displayTicker(ticker)}</span>`).join("")}
    </div>
  </article>`;
}

function renderDiscoverySignalItem(signal) {
  const href = safeExternalHref(signal.sourceUrl);
  const mapped = [...signal.mappedTickers.slice(0, 5), ...signal.mappedAShares.slice(0, 4)].slice(0, 7);
  return `<article class="discovery-list-item">
    <div class="discovery-list-title">
      ${href ? `<a href="${escapeHtml(href)}" target="_blank" rel="noreferrer">${escapeHtml(signal.title || signal.sourceName)}</a>` : `<strong>${escapeHtml(signal.title || signal.sourceName)}</strong>`}
      <span>${Math.round(signal.confidence)}</span>
    </div>
    <p>${escapeHtml(truncateText(signal.summary || signal.theme, 170))}</p>
    <div class="discovery-mini-tags">
      <span>${escapeHtml(signal.date || "日期未知")}</span>
      <span>${escapeHtml(signal.sourceType || "signal")}</span>
      ${mapped.map((ticker) => `<span>${displayTicker(ticker)}</span>`).join("")}
    </div>
  </article>`;
}

function formatDelta(value) {
  if (!Number.isFinite(value) || value === 0) return "0";
  return `${value > 0 ? "+" : ""}${value}`;
}

function getLatestHistory() {
  return discoveryState.history[discoveryState.history.length - 1] || null;
}

function getPreviousHistory() {
  return discoveryState.history[discoveryState.history.length - 2] || null;
}

function renderMiniTrend(metricKey, label) {
  const history = discoveryState.history.slice(-6);
  if (!history.length) return "";
  const values = history.map((item) => item[metricKey] || 0);
  const max = Math.max(...values, 1);
  return `<div class="mini-trend">
    <div class="mini-trend-head"><span>${escapeHtml(label)}</span><strong>${values[values.length - 1]}</strong></div>
    <div class="mini-bars">${history.map((item) => `<span style="height:${Math.max(12, Math.round(((item[metricKey] || 0) / max) * 54))}px" title="${escapeHtml(item.date)} · ${item[metricKey] || 0}"></span>`).join("")}</div>
  </div>`;
}

function renderHistoryTimeline() {
  const history = discoveryState.history.slice(-6);
  if (!history.length) return `<div class="empty-card">暂无历史趋势数据</div>`;
  return `<div class="history-timeline">
    ${history.map((item) => `<article class="history-point ${item.date === discoveryState.asOf ? "is-current" : ""}">
      <div><strong>${escapeHtml(item.date.slice(5))}</strong><span>${item.signals} 信号 · ${item.arxivPapers} 论文</span></div>
      <p>${item.observeCount} 个观察候选：${escapeHtml(item.observeTickers.slice(0, 7).map(displayTicker).join(" / ") || "无")}</p>
      ${item.reportHref ? `<a href="${escapeHtml(item.reportHref)}" target="_blank" rel="noreferrer">日报</a>` : ""}
    </article>`).join("")}
  </div>`;
}

function getActionCounts() {
  return Object.values(candidateActions.values).reduce((counts, value) => {
    const action = typeof value === "string" ? value : value?.action;
    if (action) counts[action] = (counts[action] || 0) + 1;
    return counts;
  }, {});
}

function renderDecisionPanel(visibleStocks) {
  const panel = document.getElementById("decisionPanel");
  if (!panel) return;
  const candidates = discoveryState.candidates;
  const propose = candidates.filter((candidate) => candidate.recommendation === "propose_add");
  const observe = candidates.filter((candidate) => candidate.recommendation === "observe");
  const inPool = candidates.filter((candidate) => candidate.recommendation === "already_in_pool");
  const latest = getLatestHistory();
  const previous = getPreviousHistory();
  const actionCounts = getActionCounts();
  const missing = marketState.requested ? marketState.missing : latest?.missingQuotes || [];
  const quoteRequested = marketState.requested || latest?.quotesRequested || stocks.length;
  const quoteReceived = marketState.requested ? marketState.received : latest?.quotesReceived || Object.keys(marketState.quotes).length;
  const signalsDelta = latest && previous ? latest.signals - previous.signals : 0;
  const observeDelta = latest && previous ? latest.observeCount - previous.observeCount : 0;
  const topObserve = observe.slice(0, 7);
  const healthItems = [
    `股票池 ${stocks.length} 只（美股 ${stocks.filter((stock) => stock.market === "美股").length} / A股 ${stocks.filter((stock) => stock.market === "A股").length}）`,
    `行情 ${quoteReceived}/${quoteRequested}${missing.length ? `，缺 ${missing.map(displayTicker).join("、")}` : "，全覆盖"}`,
    `arXiv ${discoveryState.papers.length || latest?.arxivPapers || 0} 篇`,
    `最后有效报告 ${discoveryState.asOf || latest?.date || "待加载"}`,
    discoveryState.status?.attemptedDate && discoveryState.status.attemptedDate !== discoveryState.asOf
      ? `最近检查 ${discoveryState.status.attemptedDate}（${discoveryState.status.status === "failed" ? "抓取失败，未覆盖旧数据" : "沿用旧数据"}）`
      : null
  ].filter(Boolean);
  panel.innerHTML = `
    <div class="decision-hero-card">
      <span>今日决策</span>
      <h2>${propose.length ? `${propose.length} 个建议新增` : "今天暂无建议新增"}</h2>
      <p>${topObserve.length ? `观察候选：${topObserve.map((candidate) => displayTicker(candidate.ticker)).join(" / ")}` : "没有新的池外观察候选。"} ${inPool.length ? `池内强化 ${inPool.length} 只。` : ""}</p>
    </div>
    <div class="decision-card">
      <span>主动发现</span>
      <strong>${candidates.length || latest?.candidates || 0}</strong>
      <p>${observe.length} 个观察候选 · ${inPool.length} 个池内强化 · 信号 ${formatDelta(signalsDelta)}</p>
    </div>
    <div class="decision-card">
      <span>处理状态</span>
      <strong>${Object.values(actionCounts).reduce((sum, count) => sum + count, 0)}</strong>
      <p>观察 ${actionCounts.watch || 0} · 入池 ${actionCounts.promote || 0} · 忽略 ${actionCounts.ignore || 0} · 研究卡 ${actionCounts.research || 0}</p>
    </div>
    <div class="decision-card health">
      <span>数据健康</span>
      <strong>${missing.length ? "有缺口" : "正常"}</strong>
      <ul>${healthItems.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
    </div>
    <div class="decision-card trend">
      <span>趋势</span>
      <strong>${latest ? `${latest.signals} 信号` : "待加载"}</strong>
      <p>观察候选 ${latest?.observeCount || observe.length}（${formatDelta(observeDelta)}）</p>
    </div>`;
}

function renderDiscovery() {
  const panel = document.getElementById("discoveryPanel");
  if (!panel) return;
  if (!discoveryState.loaded && !discoveryState.candidates.length) {
    panel.innerHTML = `<div class="empty-state">主动发现数据加载中</div>`;
    return;
  }
  if (discoveryState.error && !discoveryState.candidates.length) {
    panel.innerHTML = `<div class="empty-state">主动发现数据暂不可用<br>${escapeHtml(discoveryState.error)}</div>`;
    return;
  }

  const candidates = discoveryState.candidates;
  const watchCandidates = candidates
    .filter((candidate) => ["propose_add", "observe"].includes(candidate.recommendation))
    .slice(0, 12);
  const inPoolCandidates = candidates
    .filter((candidate) => candidate.recommendation === "already_in_pool")
    .slice(0, 10);
  const rejectedCount = candidates.filter((candidate) => candidate.recommendation === "reject").length;
  const topPapers = discoveryState.papers.slice(0, 8);
  const topSignals = discoveryState.signals.slice(0, 8);
  const runDate = discoveryState.asOf || "未知日期";
  const refreshStatus = discoveryState.status;
  const refreshStatusText = refreshStatus?.attemptedDate && refreshStatus.attemptedDate !== runDate
    ? `最近检查 ${refreshStatus.attemptedDate} · ${refreshStatus.status === "failed" ? "抓取失败，已保留有效数据" : "沿用已有数据"}`
    : refreshStatus?.status === "success"
      ? `更新成功 · ${refreshStatus.attemptedDate || runDate}`
      : "";
  const refreshStatusClass = refreshStatus?.status === "failed" ? "is-warning" : "is-ok";
  const reportLink = discoveryState.reportHref
    ? `<a class="report-link" href="${escapeHtml(discoveryState.reportHref)}" target="_blank" rel="noreferrer">打开 Markdown 日报</a>`
    : "";

  panel.innerHTML = `
    <div class="discovery-hero">
      <div>
        <span class="discovery-kicker">Discovery Engine</span>
        <h2>主动发现</h2>
        <p>每天把官方信号、arXiv 论文、新闻信号、当前股票池和行情位置合在一起，先给出候选方向，再进入人工复核。</p>
      </div>
      <div class="discovery-run-card">
        <span>最后有效报告</span>
        <strong>${escapeHtml(runDate)}</strong>
        ${refreshStatusText ? `<em class="discovery-refresh-status ${refreshStatusClass}">${escapeHtml(refreshStatusText)}</em>` : ""}
        ${reportLink}
      </div>
    </div>

    <div class="discovery-metrics" aria-label="主动发现摘要">
      <div><span>候选标的</span><strong>${candidates.length}</strong></div>
      <div><span>观察候选</span><strong>${watchCandidates.length}</strong></div>
      <div><span>池内强化</span><strong>${inPoolCandidates.length}</strong></div>
      <div><span>arXiv 论文</span><strong>${discoveryState.papers.length}</strong></div>
      <div><span>信号数量</span><strong>${discoveryState.signals.length}</strong></div>
      <div><span>暂不处理</span><strong>${rejectedCount}</strong></div>
    </div>

    <section class="discovery-section discovery-trend-section">
      <div class="discovery-section-head">
        <div><h3>历史趋势</h3><p>把最近几期主动探索日报串起来，看主题热度是否持续。</p></div>
        <span>${discoveryState.history.length} runs</span>
      </div>
      <div class="trend-grid">
        ${renderMiniTrend("signals", "信号")}
        ${renderMiniTrend("arxivPapers", "arXiv")}
        ${renderMiniTrend("candidates", "候选")}
        ${renderMiniTrend("observeCount", "观察")}
      </div>
      ${renderHistoryTimeline()}
    </section>

    <div class="discovery-grid">
      <section class="discovery-section discovery-section-wide">
        <div class="discovery-section-head">
          <div><h3>候选与观察</h3><p>池外或需要单独跟踪的名字，适合下一步人工研究。</p></div>
          <span>${watchCandidates.length} names</span>
        </div>
        <div class="candidate-grid">
          ${watchCandidates.map((candidate) => renderDiscoveryCandidateCard(candidate)).join("") || `<div class="empty-card">今天没有新增观察候选</div>`}
        </div>
      </section>

      <section class="discovery-section">
        <div class="discovery-section-head">
          <div><h3>池内强化</h3><p>已有股票池中，被新信号反复指向的标的。</p></div>
          <span>${inPoolCandidates.length} names</span>
        </div>
        <div class="compact-stack">
          ${inPoolCandidates.map((candidate) => renderDiscoveryCandidateCard(candidate, true)).join("") || `<div class="empty-card">暂无池内强化信号</div>`}
        </div>
      </section>

      <section class="discovery-section">
        <div class="discovery-section-head">
          <div><h3>arXiv 前沿论文</h3><p>技术瓶颈到产业链映射。</p></div>
          <span>${topPapers.length} papers</span>
        </div>
        <div class="discovery-list">
          ${topPapers.map(renderDiscoveryPaperItem).join("") || `<div class="empty-card">暂无论文信号</div>`}
        </div>
      </section>

      <section class="discovery-section">
        <div class="discovery-section-head">
          <div><h3>新闻与官方信号</h3><p>新闻、公司信号与产业链主题。</p></div>
          <span>${topSignals.length} signals</span>
        </div>
        <div class="discovery-list">
          ${topSignals.map(renderDiscoverySignalItem).join("") || `<div class="empty-card">暂无新闻信号</div>`}
        </div>
      </section>
    </div>`;

  panel.querySelectorAll("[data-select]").forEach((button) => {
    button.addEventListener("click", () => {
      const ticker = button.dataset.select;
      if (!stockByTicker.has(ticker)) return;
      state.query = "";
      state.market = "全部";
      state.layer = "全部";
      state.sector = "全部";
      state.status = "全部";
      state.relation = "全部";
      document.getElementById("searchInput").value = "";
      state.selected = ticker;
      hideTooltip();
      renderAll();
      activateView("graphView");
    });
  });
  panel.querySelectorAll(".candidate-actions button[data-action]").forEach((button) => {
    button.addEventListener("click", () => {
      const container = button.closest(".candidate-actions");
      const ticker = container?.dataset.ticker;
      const action = button.dataset.action;
      const currentAction = getCandidateActionValue(ticker);
      setCandidateAction(ticker, currentAction === action ? "" : action);
    });
  });
}

function updateMetrics(visibleStocks) {
  const visibleQuotes = visibleStocks.map((stock) => getQuote(stock.ticker)).filter(Boolean);
  document.getElementById("visibleMetric").textContent = visibleStocks.length;
  document.getElementById("sectorMetric").textContent = visibleQuotes.length;
  document.getElementById("analyzedMetric").textContent = visibleQuotes.filter((quote) => quote.changePercent > 0).length;
  document.getElementById("relationMetric").textContent = visibleQuotes.filter((quote) => quote.changePercent < 0).length;
  document.getElementById("visibleCount").textContent = visibleStocks.length;
  document.getElementById("totalCount").textContent = stocks.length;
}

function selectStock(ticker) {
  state.selected = state.selected === ticker ? null : ticker;
  hideTooltip();
  renderAll();
}

function activateView(viewId, syncUrl = true) {
  if (!document.getElementById(viewId)) return;
  state.view = viewId;
  document.querySelectorAll(".content-view").forEach((view) => view.classList.toggle("is-active", view.id === viewId));
  document.querySelectorAll(".view-tabs button").forEach((button) => button.classList.toggle("is-active", button.dataset.view === viewId));
  document.querySelectorAll("[data-open-view]").forEach((link) => {
    const active = link.dataset.openView === viewId;
    link.classList.toggle("is-active", active);
    if (active) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
  document.querySelector(".workbench")?.classList.toggle("policy-mode", viewId === "policyView");
  if (syncUrl && window.history?.replaceState) {
    const hash = viewId === "graphView" ? "" : `#${viewId}`;
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}${hash}`);
  }
}

function renderAll() {
  const visibleStocks = getFilteredStocks();
  if (state.selected && !visibleStocks.some((stock) => stock.ticker === state.selected)) state.selected = null;
  setActiveButton(document.getElementById("marketFilter"), state.market);
  setActiveButton(document.getElementById("layerFilter"), state.layer);
  setActiveButton(document.getElementById("relationFilter"), state.relation);
  setActiveButton(document.getElementById("graphFocusFilter"), state.focusTheme);
  setActiveButton(document.getElementById("graphModeFilter"), state.graphMode);
  renderSectorFilters();
  renderStatusFilters();
  renderGraph(visibleStocks);
  renderDetail(visibleStocks);
  renderMatrix(visibleStocks);
  renderList(visibleStocks);
  renderDiscovery();
  renderPolicy();
  renderDecisionPanel(visibleStocks);
  updateMetrics(visibleStocks);
}

function updateConnectionUi() {
  const status = document.getElementById("connectionStatus");
  const asOf = document.getElementById("marketAsOf");
  const refresh = document.getElementById("refreshQuotes");
  refresh.disabled = marketState.loading;
  refresh.classList.toggle("is-loading", marketState.loading);
  if (marketState.loading) {
    status.textContent = "行情同步中";
    return;
  }
  if (marketState.error) {
    status.textContent = marketState.error;
    asOf.textContent = "离线";
    return;
  }
  if (marketState.asOf) {
    status.textContent = marketState.stale ? "缓存行情" : "最新行情（可能延迟）";
    asOf.textContent = formatAsOf(marketState.asOf);
  }
}

async function loadQuotes(force = false) {
  if (window.location.protocol === "file:") {
    marketState.error = "请使用实时行情入口";
    updateConnectionUi();
    return;
  }

  marketState.loading = true;
  marketState.error = null;
  marketState.stale = false;
  updateConnectionUi();
  try {
    const response = await fetch(`/api/quotes${force ? "?refresh=1" : ""}`, { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "行情暂时不可用");
    marketState.quotes = payload.quotes || {};
    marketState.asOf = payload.asOf || null;
    marketState.source = payload.source || null;
    marketState.requested = payload.requested || Object.keys(marketState.quotes).length;
    marketState.received = payload.received || Object.keys(marketState.quotes).length;
    marketState.missing = payload.missing || [];
    marketState.markets = payload.markets || {};
    marketState.stale = Boolean(payload.stale);
    renderAll();
  } catch (error) {
    marketState.error = error instanceof Error ? error.message : "行情暂时不可用";
  } finally {
    marketState.loading = false;
    updateConnectionUi();
  }
}

function initializeEvents() {
  initializeGraphInteractions();

  document.getElementById("searchInput").addEventListener("input", (event) => {
    state.query = event.target.value;
    const query = state.query.trim().toLowerCase();
    if (query) {
      const matches = stocks.filter((stock) => [stock.ticker, displayTicker(stock.ticker), stock.company].some((value) => String(value).toLowerCase() === query));
      if (matches.length === 1) state.selected = matches[0].ticker;
    }
    renderAll();
  });

  document.getElementById("resetButton").addEventListener("click", () => {
    state.query = "";
    state.market = "全部";
    state.layer = "全部";
    state.sector = "全部";
    state.status = "全部";
    state.relation = "全部";
    state.focusTheme = "全部";
    state.graphMode = "全部";
    state.selected = null;
    document.getElementById("searchInput").value = "";
    renderAll();
  });

  document.getElementById("refreshQuotes").addEventListener("click", () => loadQuotes(true));

  document.querySelectorAll("#marketFilter button").forEach((button) => {
    button.addEventListener("click", () => {
      state.market = button.dataset.value;
      state.sector = "全部";
      state.status = "全部";
      state.selected = null;
      renderAll();
    });
  });

  document.querySelectorAll("#layerFilter button").forEach((button) => {
    button.addEventListener("click", () => {
      state.layer = button.dataset.value;
      renderAll();
    });
  });

  document.querySelectorAll("#relationFilter button").forEach((button) => {
    button.addEventListener("click", () => {
      state.relation = button.dataset.value;
      renderAll();
    });
  });

  document.querySelectorAll("#graphFocusFilter button").forEach((button) => {
    button.addEventListener("click", () => {
      state.focusTheme = button.dataset.value;
      state.selected = null;
      renderAll();
    });
  });

  document.querySelectorAll("#graphModeFilter button").forEach((button) => {
    button.addEventListener("click", () => {
      state.graphMode = button.dataset.value;
      renderAll();
    });
  });

  document.querySelectorAll(".view-tabs button").forEach((button) => {
    button.addEventListener("click", () => activateView(button.dataset.view));
  });

  document.querySelectorAll("[data-open-view]").forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      const viewId = link.dataset.openView;
      activateView(viewId);
      const target = document.getElementById(viewId);
      const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
      target?.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
    });
  });

  document.querySelectorAll("th button[data-sort]").forEach((button) => {
    button.addEventListener("click", () => {
      const key = button.dataset.sort;
      if (state.sortKey === key) state.sortDirection *= -1;
      else {
        state.sortKey = key;
        state.sortDirection = 1;
      }
      renderMatrix(getFilteredStocks());
    });
  });
}

document.addEventListener("DOMContentLoaded", async () => {
  document.querySelectorAll('a[href^="https://mastersgo.cc"]').forEach(link => {
    const url = new URL(link.href);
    link.href = workbenchOrigin(isDesignPreview) + url.pathname + url.hash;
  });
  loadCandidateActions();
  try {
    await loadStockPool();
  } catch (error) {
    console.error(error);
    rebuildDataModel();
  }
  try {
    await loadDiscoveryData();
  } catch (error) {
    console.error(error);
    discoveryState.loaded = true;
    discoveryState.error = error instanceof Error ? error.message : "主动发现数据暂不可用";
  }
  await loadPolicyData();
  initializeEvents();
  renderAll();
  const requestedView = window.location.hash.replace(/^#/, "");
  const initialView = ["graphView", "matrixView", "listView", "discoveryView", "policyView"].includes(requestedView)
    ? requestedView
    : "graphView";
  activateView(initialView, false);
  if (initialView === "policyView") {
    window.requestAnimationFrame(() => document.getElementById("policyView")?.scrollIntoView({ block: "start" }));
  }
  if (window.lucide) window.lucide.createIcons();
  loadQuotes(false);
  marketState.timer = window.setInterval(() => loadQuotes(false), 60_000);
  policyState.timer = window.setInterval(() => loadPolicyData(false), 300_000);
});
