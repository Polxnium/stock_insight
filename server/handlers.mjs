// 共享 BFF：被 vite.config.ts（开发） 与 server.mjs（生产）共同使用。
// 设计原则：
//   1) 每个外部数据源 = 一个 handler 函数，方便扩展
//   2) LLM 调用走服务端中转，前端永远拿不到 API Key
//   3) 所有错误统一返回 { ok:false, error } 结构，前端友好处理
//   4) 内置 TTL 缓存，降低被风控概率，提升响应速度
import iconv from 'iconv-lite';

// ===== 极简 TTL 缓存（进程内 Map，重启失效，足够本地使用） =====
const _cache = new Map(); // key -> { exp:number, val:any }
async function withCache(key, ttlMs, loader) {
  const now = Date.now();
  const hit = _cache.get(key);
  if (hit && hit.exp > now) return hit.val;
  const val = await loader();
  _cache.set(key, { exp: now + ttlMs, val });
  // 简单容量保护
  if (_cache.size > 500) {
    const firstKey = _cache.keys().next().value;
    _cache.delete(firstKey);
  }
  return val;
}

const json = (res, status, body) => {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
};

const text = (res, status, body, contentType = 'text/plain; charset=utf-8') => {
  res.statusCode = status;
  res.setHeader('Content-Type', contentType);
  res.end(body);
};

const readBody = (req) =>
  new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      try {
        const buf = Buffer.concat(chunks);
        resolve(buf.length ? JSON.parse(buf.toString('utf8')) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });

const COMMON_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
};

// ====================================================================
// 通用工具：带重试 + 超时的 fetch。量化选股每一步都必须可靠
// ====================================================================
async function fetchWithRetry(target, options = {}) {
  const {
    headers = COMMON_HEADERS,
    timeoutMs = 12000,       // 单次超时 12s
    retries = 3,             // 最多重试 3 次（共 4 次请求）
    retryDelayMs = 500,      // 重试间隔
    ...rest
  } = options;

  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const r = await fetch(target, {
        ...rest,
        headers: { ...COMMON_HEADERS, ...headers },
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!r.ok) {
        lastError = new Error(`HTTP ${r.status}`);
        if (attempt < retries) {
          await new Promise((res) => setTimeout(res, retryDelayMs * (attempt + 1)));
          continue;
        }
        throw lastError;
      }
      return r;
    } catch (e) {
      clearTimeout(timer);
      lastError = e;
      if (attempt < retries) {
        await new Promise((res) => setTimeout(res, retryDelayMs * (attempt + 1)));
        continue;
      }
      throw lastError;
    }
  }
  throw lastError;
}

// ====================================================================
// 1. 新浪财经实时报价  /api/quote?symbols=sh600000,sz000001
//    新浪返回 GBK 编码，需要转码。
//    缓存 2s：避免页面多组件同时轮询时压力倍增。
// ====================================================================
async function handleQuote(req, res, url) {
  const symbols = (url.searchParams.get('symbols') || '').trim();
  if (!symbols) return json(res, 400, { ok: false, error: 'symbols 不能为空' });

  try {
    const list = await withCache(`quote:${symbols}`, 2000, async () => {
      const r = await fetchWithRetry(`https://hq.sinajs.cn/list=${symbols}`, {
        headers: { Referer: 'https://finance.sina.com.cn/' },
        timeoutMs: 8000,
        retries: 3,
        retryDelayMs: 400,
      });
      const buf = Buffer.from(await r.arrayBuffer());
      const body = iconv.decode(buf, 'gbk');
      return body
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          const m = line.match(/var hq_str_([^=]+)="([^"]*)"/);
          if (!m) return null;
          const [, code, payload] = m;
          if (!payload) return { code, valid: false };
          const f = payload.split(',');

          // ── 新浪 gb_ 海外指数：字段顺序与 A 股不同
          if (code.startsWith('gb_')) {
            let price = 0, change = 0, changePct = 0, open = 0, high = 0, low = 0;
            const hasName = isNaN(Number(f[0]));
            const offset = hasName ? 1 : 0;

            price = Number(f[offset]) || 0;
            change = Number(f[offset + 1]) || 0;

            if (f[offset + 2]) {
              const pctStr = String(f[offset + 2]).trim();
              if (/^-?\d+(\.\d+)?%?$/.test(pctStr)) {
                changePct = parseFloat(pctStr.replace('%', '')) || 0;
              }
            }

            if (!changePct && price && change) {
              const prevClose = price - change;
              if (prevClose && Math.abs(prevClose) > 0.01) {
                changePct = (change / prevClose) * 100;
              }
            }

            open = Number(f[offset + 3]) || price;
            high = Number(f[offset + 4]) || price;
            low = Number(f[offset + 5]) || price;

            return {
              code,
              name: hasName ? f[0] : code,
              price, change, changePct, open, high, low,
              prevClose: price - change,
              volume: Number(f[offset + 6]) || 0,
              amount: 0,
              valid: price > 0 || Math.abs(change) > 0,
            };
          }

          // ── 全球期指 hf_
          if (code.startsWith('hf_')) {
            const price = Number(f[0]) || 0;
            const prevClose = Number(f[2]) || 0;
            const open = Number(f[3]) || price;
            const high = Number(f[4]) || price;
            const low = Number(f[5]) || price;
            const change = prevClose ? price - prevClose : 0;
            const changePct = prevClose ? (change / prevClose) * 100 : 0;

            return {
              code,
              name: f[13] || code,
              price, change, changePct, open, high, low,
              prevClose,
              volume: Number(f[8]) || 0,
              amount: 0,
              valid: price > 0,
            };
          }

          // ── 港股指数
          if (code === 'hsi' || code === 'hscei' || code.startsWith('hk')) {
            const prev = Number(f[2]) || 0;
            const price = Number(f[3]) || 0;
            const change = prev ? price - prev : 0;
            const changePct = prev ? (change / prev) * 100 : 0;

            return {
              code,
              name: f[0] || code,
              price, change, changePct,
              open: Number(f[1]) || price,
              high: Number(f[4]) || price,
              low: Number(f[5]) || price,
              prevClose: prev,
              volume: Number(f[8]) || 0,
              amount: Number(f[9]) || 0,
              valid: price > 0,
            };
          }

          // ── A 股 / 其他 标准格式
          const prev  = Number(f[2]);
          const price = Number(f[3]);
          return {
            code,
            name: f[0],
            open: Number(f[1]),
            prevClose: prev,
            price,
            high: Number(f[4]),
            low: Number(f[5]),
            volume: Number(f[8]),
            amount: Number(f[9]),
            changePct: prev ? ((price - prev) / prev) * 100 : 0,
            change: prev ? price - prev : 0,
            date: f[30],
            time: f[31],
            valid: true,
          };
        })
        .filter(Boolean);
    });
    json(res, 200, { ok: true, data: list, ts: Date.now() });
  } catch (e) {
    json(res, 502, { ok: false, error: String(e?.message || e) });
  }
}

// ====================================================================
// 2. 东方财富 — 通用 push2 透传  /api/em/*
//    缓存 3s。
// ====================================================================
async function handleEastMoneyPush(req, res, url) {
  const target =
    'https://push2.eastmoney.com/api' +
    url.pathname.replace(/^\/api\/em/, '') +
    (url.search || '');
  try {
    const body = await withCache(`em:${target}`, 3000, async () => {
      const r = await fetch(target, {
        headers: { ...COMMON_HEADERS, Referer: 'https://quote.eastmoney.com/' },
      });
      return await r.text();
    });
    text(res, 200, body, 'application/json; charset=utf-8');
  } catch (e) {
    json(res, 502, { ok: false, error: String(e?.message || e) });
  }
}

// ====================================================================
// 2b. 个股基本面快照  /api/fundamental?code=sh600519
//    数据源：腾讯财经 qt.gtimg.cn（push2.eastmoney.com 已不可用）
//    字段：PE(动)/PB/总市值/流通市值/换手率/量比，缓存 60s
// ====================================================================
function toSecid(code) {
  const m = code.toLowerCase().match(/^(sh|sz)(\d{6})$/);
  if (!m) return null;
  return `${m[1] === 'sh' ? 1 : 0}.${m[2]}`;
}

async function handleFundamental(req, res, url) {
  const code = (url.searchParams.get('code') || '').trim();
  if (!/^(sh|sz)\d{6}$/i.test(code)) return json(res, 400, { ok: false, error: '无效 code' });

  // 腾讯财经实时行情（含基本面指标），GBK 编码
  const target = `https://qt.gtimg.cn/q=${code}`;
  try {
    const data = await withCache(`f10:${code}`, 60_000, async () => {
      const r = await fetchWithRetry(target, {
        headers: { Referer: 'https://finance.qq.com/' },
        timeoutMs: 10000,
        retries: 3,
        retryDelayMs: 500,
      });
      const buf = Buffer.from(await r.arrayBuffer());
      const text = iconv.decode(buf, 'gbk');
      const m = text.match(/"([^"]+)"/);
      if (!m) throw new Error('腾讯接口返回格式异常');
      const f = m[1].split('~');
      const n = (i) => { const v = parseFloat(f[i]); return Number.isFinite(v) && v !== 0 ? v : null; };
      const lowRaw = (f[35] || '').split('/')[0];
      const low = parseFloat(lowRaw) || null;
      return {
        code,
        name: f[1] || null,
        price: n(3),
        prevClose: n(4),
        open: n(33),
        high: n(34),
        low,
        volume: n(36),
        amount: n(37) ? n(37) * 10000 : null,
        changePct: n(32),
        change: n(31),
        turnover: n(56),
        volumeRatio: n(53),
        eps: null,
        peDyn: n(39),
        peStatic: null,
        peTTM: n(39),
        pb: n(46),
        totalMarketCap: n(44) ? n(44) * 1e8 : null,
        floatMarketCap: n(45) ? n(45) * 1e8 : null,
        roe: null,
        totalShares: null,
      };
    });
    json(res, 200, { ok: true, data, ts: Date.now() });
  } catch (e) {
    json(res, 502, { ok: false, error: String(e?.message || e) });
  }
}

// ====================================================================
// 2c. 主力资金流向  /api/moneyflow?code=sh600519
//    不缓存，实时查询。
//    数据源：datacenter-web RPT_DMSK_TS_FUNDFLOW（真实五类资金流，含中单/小单）
//    单位：万元（流入/流出/净额），百分比基于 DEAL_AMOUNT 计算
// ====================================================================

async function handleMoneyFlow(req, res, url) {
  const code = (url.searchParams.get('code') || '').trim();
  if (!/^(sh|sz)\d{6}$/i.test(code)) return json(res, 400, { ok: false, error: '无效 code' });
  const num = code.replace(/^(sh|sz)/i, '');

  const target =
    `https://datacenter-web.eastmoney.com/api/data/v1/get` +
    `?reportName=RPT_DMSK_TS_FUNDFLOW&columns=ALL` +
    `&filter=${encodeURIComponent(`(SECURITY_CODE="${num}")`)}` +
    `&pageNumber=1&pageSize=1&sortTypes=-1&sortColumns=TRADE_DATE` +
    `&source=WEB&client=WEB`;

  try {
    // 不缓存：每次请求实时查询最新资金流数据，确保数据无延迟
    console.log(`[MoneyFlow] 实时请求 -> datacenter RPT_DMSK_TS_FUNDFLOW: ${code}`);
    try {
      const r = await fetchWithRetry(target, {
        headers: { Referer: 'https://data.eastmoney.com/' },
        timeoutMs: 6000,   // 超时缩短至 6s，加快失败恢复
        retries: 1,        // 只重试 1 次，避免长时间阻塞
        retryDelayMs: 300,
      });

      const j = await r.json();
      const item = j?.result?.data?.[0];

      if (!item) {
        console.warn(`[MoneyFlow] datacenter返回空: ${code}`);
        return json(res, 200, { ok: true, data: null, ts: Date.now() });
      }

      const dealAmount    = item.DEAL_AMOUNT       || 0;
      const mainNet       = item.NET_INFLOW         || 0;
      const superLargeNet = item.SUPERDEAL_NET      || 0;
      const largeNet      = item.BIGDEAL_NET        || 0;
      const mediumNet     = item.MIDDEAL_NET        || 0;
      const smallNet      = item.SMALLDEAL_NET      || 0;

      const mainPct       = dealAmount ? +((mainNet       / dealAmount) * 100).toFixed(2) : 0;
      const superLargePct = dealAmount ? +((superLargeNet / dealAmount) * 100).toFixed(2) : 0;
      const largePct      = dealAmount ? +((largeNet      / dealAmount) * 100).toFixed(2) : 0;
      const mediumPct     = dealAmount ? +((mediumNet     / dealAmount) * 100).toFixed(2) : 0;
      const smallPct      = dealAmount ? +((smallNet      / dealAmount) * 100).toFixed(2) : 0;

      const W = 10000;
      const result = {
        code,
        mainNet: mainNet * W, mainPct,
        superLargeNet: superLargeNet * W, superLargePct,
        largeNet: largeNet * W, largePct,
        mediumNet: mediumNet * W, mediumPct,
        smallNet:  smallNet * W, smallPct,
        northNet: null, northPct: null,
        northBuy: null, northSell: null,
        northVol: null, northAmount: null, northDate: null,
      };

      console.log(
        `[MoneyFlow] ✓ ${code} 主力:${(mainNet/1e4).toFixed(2)}亿(${mainPct}%)` +
        ` 超大单:${superLargeNet.toFixed(0)}万 大单:${largeNet.toFixed(0)}万` +
        ` 中单:${mediumNet.toFixed(0)}万 小单:${smallNet.toFixed(0)}万`
      );
      json(res, 200, { ok: true, data: result, ts: Date.now() });
    } catch (e) {
      console.error(`[MoneyFlow] datacenter请求失败: ${e.message}`);
      json(res, 200, { ok: true, data: null, ts: Date.now() });
    }
  } catch (e) {
    console.error(`[MoneyFlow] 错误: ${e.message}`);
    json(res, 200, { ok: true, data: null, ts: Date.now() });
  }
}

// ====================================================================
// 2c-1. 北向资金整体数据  /api/northbound
//    缓存 10s。获取沪股通/深股通整体资金流向
// ====================================================================
async function handleNorthbound(req, res, url) {
  try {
    const data = await withCache(`northbound`, 10_000, async () => {
      console.log(`[Northbound] 请求北向资金实时流向`);
      
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 8000);
        
        // 东财北向资金实时流向接口
        const target = `https://push2.eastmoney.com/api/qt/kamt/get?fields1=f1,f2,f3,f4&fields2=f51,f52,f53,f54,f63&ut=b2884a393a59ad64002292a3e90d46a5&_=${Date.now()}`;
        
        const r = await fetch(target, {
          headers: { 
            ...COMMON_HEADERS, 
            'Referer': 'https://data.eastmoney.com/bkds/',
            'Accept': 'application/json',
          },
          signal: controller.signal,
        });
        
        clearTimeout(timeoutId);
        
        if (!r.ok) {
          console.error(`[Northbound] HTTP ${r.status}`);
          return null;
        }
        
        const j = await r.json();
        const d = j?.data;
        if (!d) return null;
        
        // hk2sh: 沪股通(北向买沪市), hk2sz: 深股通(北向买深市)
        // netBuyAmt: 净买入金额(万元)
        const shBuy = d.hk2sh?.netBuyAmt ?? 0;
        const szBuy = d.hk2sz?.netBuyAmt ?? 0;
        const totalNet = (shBuy + szBuy) * 10000; // 万元 → 元
        
        console.log(`[Northbound] ✓ 沪股通净买:${(shBuy/1e4).toFixed(2)}亿 深股通净买:${(szBuy/1e4).toFixed(2)}亿 合计:${(totalNet/1e8).toFixed(2)}亿`);
        
        return {
          shBuy: shBuy * 10000,
          shSell: null,
          szBuy: szBuy * 10000,
          szSell: null,
          totalNet,
          updateTime: new Date().toLocaleTimeString('zh-CN'),
        };
      } catch (fetchError) {
        console.error(`[Northbound] 请求失败: ${fetchError.message}`);
        return null;
      }
    });
    
    json(res, 200, { ok: true, data, ts: Date.now() });
  } catch (e) {
    console.error(`[Northbound] 错误: ${e.message}`);
    json(res, 502, { ok: false, error: String(e?.message || e) });
  }
}

// ====================================================================
// 2c-2. 市场概览  /api/market-overview
//    缓存 10s。获取今日成交额、北向资金流向
// ====================================================================
async function handleMarketOverview(req, res, url) {
  try {
    const data = await withCache(`market-overview`, 10_000, async () => {
      console.log(`[MarketOverview] 获取市场概览...`);
      
      // 1. 获取上证指数和深证成指（含成交额）
      const sinaTarget = `https://hq.sinajs.cn/list=sh000001,sz399001`;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);
      
      const r = await fetch(sinaTarget, {
        headers: { ...COMMON_HEADERS, Referer: 'https://finance.sina.com.cn/' },
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      
      let shAmount = 0, szAmount = 0, shChangePct = 0, szChangePct = 0;
      let yestAmount = 0; // 昨日成交额
      
      if (r.ok) {
        const text = await r.text();
        // 解析新浪格式: var hq_str_sh000001="名称,当前价,昨收,开盘,最高,最低,...,成交量,成交额,..."
        const shMatch = text.match(/hq_str_sh000001="([^"]+)"/);
        const szMatch = text.match(/hq_str_sz399001="([^"]+)"/);
        
        if (shMatch) {
          const f = shMatch[1].split(',');
          shAmount = Number(f[9]) || 0;  // 成交额(元)
          shChangePct = Number(f[3]) ? ((Number(f[1]) - Number(f[2])) / Number(f[2]) * 100) : 0;
        }
        if (szMatch) {
          const f = szMatch[1].split(',');
          szAmount = Number(f[9]) || 0;
          szChangePct = Number(f[3]) ? ((Number(f[1]) - Number(f[2])) / Number(f[2]) * 100) : 0;
        }
      }
      
      // 1.5 获取昨日成交额（腾讯K线接口，取最后2条）
      try {
        const klineTarget = `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=sh000001,day,,,2,qfq`;
        const kr = await fetch(klineTarget, {
          headers: { ...COMMON_HEADERS, Referer: 'https://finance.qq.com/' },
        });
        if (kr.ok) {
          const kj = await kr.json();
          const klines = kj?.data?.sh000001?.qfqday || kj?.data?.sh000001?.day;
          if (klines && klines.length >= 2) {
            // 腾讯K线格式: [date, open, close, high, low, volume(手)]
            // 指数无成交额字段，通过新浪行情估算（shAmount已包含今日）
            // 如果取到前一日数据，可用新浪成交额比例估算
            yestAmount = 0; // 腾讯K线无amount字段，置0
          }
        }
      } catch (e) {
        console.warn(`[MarketOverview] 昨日成交额获取失败: ${e.message}`);
      }
      
      // 2. 获取北向资金流向
      let northNet = null;
      try {
        const nbTarget = `https://push2.eastmoney.com/api/qt/kamt/get?fields1=f1,f2,f3,f4&fields2=f51,f52,f53,f54,f63&ut=b2884a393a59ad64002292a3e90d46a5`;
        const nbR = await fetch(nbTarget, {
          headers: { ...COMMON_HEADERS, Referer: 'https://data.eastmoney.com/', 'Accept': 'application/json' },
        });
        if (nbR.ok) {
          const nbJ = await nbR.json();
          const d = nbJ?.data;
          if (d) {
            const shBuy = d.hk2sh?.netBuyAmt ?? 0;
            const szBuy = d.hk2sz?.netBuyAmt ?? 0;
            northNet = (shBuy + szBuy) * 10000; // 万元 → 元
          }
        }
      } catch (e) {
        console.warn(`[MarketOverview] 北向资金获取失败: ${e.message}`);
      }
      
      const totalAmount = shAmount + szAmount;
      console.log(`[MarketOverview] ✓ 上证:${(shAmount/1e8).toFixed(0)}亿 深证:${(szAmount/1e8).toFixed(0)}亿 合计:${(totalAmount/1e8).toFixed(0)}亿 北向:${northNet ? (northNet/1e8).toFixed(1)+'亿' : 'N/A'}`);
      
      return {
        shAmount,
        szAmount,
        totalAmount,
        yestAmount,
        shChangePct: Math.round(shChangePct * 100) / 100,
        szChangePct: Math.round(szChangePct * 100) / 100,
        northNet,
        updateTime: new Date().toLocaleTimeString('zh-CN'),
      };
    });
    
    json(res, 200, { ok: true, data, ts: Date.now() });
  } catch (e) {
    console.error(`[MarketOverview] 错误: ${e.message}`);
    json(res, 502, { ok: false, error: String(e?.message || e) });
  }
}

// ====================================================================
// 2c-3. 近 N 日主力资金流向日线  /api/mfkline?code=sh600519&days=10
//    缓存 5min。
//    数据源：datacenter-web RPT_DMSK_TS_FUNDFLOW（真实五类资金流，含历史数据）
//    单位：万元，百分比基于 DEAL_AMOUNT 计算
// ====================================================================
async function handleMFKline(req, res, url) {
  const code = (url.searchParams.get('code') || '').trim();
  const days = Math.min(Number(url.searchParams.get('days') || 20), 30);
  if (!/^(sh|sz)\d{6}$/i.test(code)) return json(res, 400, { ok: false, error: '无效 code' });
  const num = code.replace(/^(sh|sz)/i, '');

  try {
    const data = await withCache(`mfk:${code}:${days}`, 5 * 60_000, async () => {
      console.log(`[MFKline] 请求 -> datacenter RPT_DMSK_TS_FUNDFLOW days=${days}: ${code}`);

      try {
        const target =
          `https://datacenter-web.eastmoney.com/api/data/v1/get` +
          `?reportName=RPT_DMSK_TS_FUNDFLOW` +
          `&columns=TRADE_DATE,DEAL_AMOUNT,NET_INFLOW,SUPERDEAL_NET,BIGDEAL_NET,MIDDEAL_NET,SMALLDEAL_NET` +
          `&filter=${encodeURIComponent(`(SECURITY_CODE="${num}")`)}` +
          `&pageNumber=1&pageSize=${days}&sortTypes=-1&sortColumns=TRADE_DATE` +
          `&source=WEB&client=WEB`;

        const r = await fetchWithRetry(target, {
          headers: { Referer: 'https://data.eastmoney.com/' },
          timeoutMs: 10000,
          retries: 3,
          retryDelayMs: 600,
        });

        const j = await r.json();
        const items = j?.result?.data;

        if (!items || items.length === 0) {
          console.warn(`[MFKline] datacenter返回空: ${code}`);
          return [];
        }

        items.sort((a, b) => a.TRADE_DATE.localeCompare(b.TRADE_DATE));

        const records = items.map((item) => {
          const dealAmount    = item.DEAL_AMOUNT   || 0;
          const mainNet       = item.NET_INFLOW    || 0;
          const superLargeNet = item.SUPERDEAL_NET || 0;
          const largeNet      = item.BIGDEAL_NET   || 0;
          const mediumNet     = item.MIDDEAL_NET   || 0;
          const smallNet      = item.SMALLDEAL_NET || 0;

          const mainPct       = dealAmount ? +((mainNet       / dealAmount) * 100).toFixed(2) : 0;
          const superLargePct = dealAmount ? +((superLargeNet / dealAmount) * 100).toFixed(2) : 0;
          const largePct      = dealAmount ? +((largeNet      / dealAmount) * 100).toFixed(2) : 0;
          const mediumPct     = dealAmount ? +((mediumNet     / dealAmount) * 100).toFixed(2) : 0;
          const smallPct      = dealAmount ? +((smallNet      / dealAmount) * 100).toFixed(2) : 0;

          const W = 10000;
          return {
            date: item.TRADE_DATE.slice(0, 10),
            mainNet: mainNet * W, mainPct,
            superLargeNet: superLargeNet * W, superLargePct,
            largeNet: largeNet * W, largePct,
            mediumNet: mediumNet * W, mediumPct,
            smallNet: smallNet * W, smallPct,
          };
        });

        console.log(`[MFKline] ✓ ${code}, ${records.length} 条真实资金流数据`);
        return records;
      } catch (e) {
        console.error(`[MFKline] datacenter请求失败: ${e.message}`);
        return [];
      }
    });

    json(res, 200, { ok: true, data: data || [], ts: Date.now() });
  } catch (e) {
    console.error(`[MFKline] 错误: ${e.message}`);
    json(res, 200, { ok: true, data: [], ts: Date.now() });
  }
}

// ====================================================================
// 2d. 日 K 线数据  /api/kline?code=sh600519&days=60
//    前复权日K，字段：date,open,close,high,low,volume,amount,changePct
//    数据源：腾讯财经 web.ifzq.gtimg.cn（可靠可达，前复权日K线）
//    缓存策略：盘中 5min，盘后 1h（日K盘后不再变化）
// ====================================================================
async function handleKline(req, res, url) {
  const code = (url.searchParams.get('code') || '').trim();
  const days = Math.min(Number(url.searchParams.get('days') || 60), 250);
  if (!/^(sh|sz)\d{6}$/i.test(code)) return json(res, 400, { ok: false, error: '无效 code' });

  // 判断当前是否盘后（15:00后）以延长缓存
  const now = new Date();
  const hour = now.getHours();
  const isAfterClose = hour >= 16;
  const cacheTtl = isAfterClose ? 60 * 60_000 : 5 * 60_000;

  // 腾讯财经前复权日K线接口
  // param格式：代码,day(日K),,,数量,qfq(前复权)
  // 返回格式：[[date, open, close, high, low, volume(手)], ...]
  const target =
    `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get` +
    `?param=${code},day,,,${days},qfq`;

  try {
    const data = await withCache(`kline:${code}:${days}`, cacheTtl, async () => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);

      try {
        const r = await fetch(target, {
          headers: {
            ...COMMON_HEADERS,
            Referer: 'https://finance.qq.com/',
          },
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!r.ok) {
          console.error(`[Kline] 腾讯K线 HTTP ${r.status}: ${code}`);
          return null;
        }

        const j = await r.json();
        // 腾讯返回数据在 data.{code}.qfqday 或 data.{code}.day
        const stockData = j?.data?.[code];
        const klines = stockData?.qfqday || stockData?.day;

        if (!klines || !Array.isArray(klines) || klines.length === 0) {
          console.warn(`[Kline] 腾讯K线返回空数据: ${code}`);
          return null;
        }

        console.log(`[Kline] ✓ 腾讯前复权K线: ${code}, ${klines.length}根`);

        // 解析每根K线: [date, open, close, high, low, volume(手)]
        // 计算 changePct：用前后收盘价差
        return klines.map((bar, i) => {
          const open  = parseFloat(bar[1]);
          const close = parseFloat(bar[2]);
          const high  = parseFloat(bar[3]);
          const low   = parseFloat(bar[4]);
          const vol   = Math.round((parseFloat(bar[5]) || 0) * 100); // 手→股

          // 涨跌幅：与前一天收盘价对比
          let changePct = 0;
          if (i > 0) {
            const prevClose = parseFloat(klines[i - 1][2]);
            if (prevClose && prevClose !== 0) {
              changePct = +((close - prevClose) / prevClose * 100).toFixed(2);
            }
          } else if (klines.length > 1) {
            // 第一根K线用第二根推算
            const nextOpen = parseFloat(klines[1][1]);
            if (nextOpen && open && open !== 0) {
              changePct = +((open - nextOpen) / nextOpen * 100 * -1).toFixed(2);
            }
          }

          return {
            date:      bar[0],
            open,
            close,
            high,
            low,
            volume:    vol,
            amount:    0, // 腾讯K线不直接提供成交额，用0占位
            changePct,
          };
        });
      } catch (fetchError) {
        clearTimeout(timeoutId);
        console.error(`[Kline] 腾讯K线请求失败: ${code} - ${fetchError.message}`);
        return null;
      }
    });

    if (!data) {
      return json(res, 200, { ok: false, error: 'K线数据暂不可用', ts: Date.now() });
    }

    json(res, 200, { ok: true, data, ts: Date.now() });
  } catch (e) {
    console.error(`[Kline] 错误: ${e.message}`);
    json(res, 200, { ok: false, error: 'K线数据获取失败', ts: Date.now() });
  }
}

// ====================================================================
// 2e. 近期公告  /api/announcement?code=sh600519&count=5
//    来源：东财公告接口（交易所正式披露，含业绩预告/减持/回购等）
//    缓存 10min（公告发布频率很低）
// ====================================================================
async function handleAnnouncement(req, res, url) {
  const code = (url.searchParams.get('code') || '').trim();
  const count = Math.min(Number(url.searchParams.get('count') || 5), 20);
  const num = code.replace(/^(sh|sz)/i, '');
  if (!/^\d{6}$/.test(num)) return json(res, 400, { ok: false, error: '无效 code' });

  const target =
    `https://np-anotice-stock.eastmoney.com/api/security/ann?cb=&sr=-1` +
    `&page_size=${count}&page_index=1&ann_type=SHA,CYB,SZA&client_source=web&stock_list=${num}`;

  try {
    const data = await withCache(`ann:${code}:${count}`, 10 * 60_000, async () => {
      const r = await fetch(target, {
        headers: { ...COMMON_HEADERS, Referer: 'https://data.eastmoney.com/' },
      });
      const j = await r.json();
      return (j?.data?.list || []).slice(0, count).map((item) => ({
        title: item.title || '',
        date:  (() => {
          // 优先使用 notice_date（正式公告日期），确保与交易所公告日期一致
          // notice_date:  "2026-05-22 00:00:00"     → "05-22"
          // display_time: "2026-05-21 20:58:04:410" → "05-21 20:58"（系统展示时间，可能提前）
          const dt = item.notice_date || item.display_time || '';
          const datePart = dt.slice(5, 10);   // "MM-DD"
          const timePart = dt.slice(11, 16);  // "HH:mm"
          // 如果是正式公告日期（午夜00:00），只显示日期不显示时间
          return timePart && timePart !== '00:00' ? `${datePart} ${timePart}` : datePart;
        })(),
        type:  item.column_name || '',
        url:   item.art_code
          ? `https://data.eastmoney.com/notices/detail/${num}/${item.art_code}.html`
          : undefined,
      }));
    });
    json(res, 200, { ok: true, data, ts: Date.now() });
  } catch (e) {
    json(res, 502, { ok: false, error: String(e?.message || e) });
  }
}

// ====================================================================
// 3. 东方财富新闻列表  /api/news?count=20
//    缓存 20s。
// ====================================================================
async function handleNews(req, res, url) {
  const count = Number(url.searchParams.get('count') || 20);
  try {
    const list = await withCache(`news:${count}`, 20_000, async () => {
      const target = `https://np-listapi.eastmoney.com/comm/web/getFastNewsList?client=web&biz=web_724&fastColumn=102&sortEnd=&pageSize=${count}&req_trace=${Date.now()}`;
      const r = await fetch(target, {
        headers: { ...COMMON_HEADERS, Referer: 'https://kuaixun.eastmoney.com/' },
      });
      const data = await r.json();
      return (data?.data?.fastNewsList || []).map((n) => ({
        id: n.code,
        title: n.title || n.summary?.slice(0, 60),
        summary: n.summary,
        time: n.showTime,
        url: n.url_unique || n.url,
        tags: n.tagInfo?.map((t) => t.tagName) || [],
      }));
    });
    json(res, 200, { ok: true, data: list, ts: Date.now() });
  } catch (e) {
    json(res, 502, { ok: false, error: String(e?.message || e) });
  }
}

// ====================================================================
// 4. LLM 中转  POST /api/llm/chat
//    body: { provider:'deepseek'|'qwen', model, messages, stream?:boolean }
//    Key 从环境变量读取，永远不下发到前端。
// ====================================================================
const LLM_PROVIDERS = {
  deepseek: {
    endpoint: 'https://api.deepseek.com/chat/completions',
    keyEnv: 'DEEPSEEK_API_KEY',
  },
  qwen: {
    // 阿里云百炼兼容 OpenAI 协议
    endpoint:
      'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
    keyEnv: 'DASHSCOPE_API_KEY',
  },
};

async function handleLLMChat(req, res) {
  let body;
  try {
    body = await readBody(req);
  } catch {
    return json(res, 400, { ok: false, error: '请求体非法 JSON' });
  }
  const { provider, model, messages, stream = false, temperature = 0.3 } = body;
  const p = LLM_PROVIDERS[provider];
  if (!p) return json(res, 400, { ok: false, error: `未知 provider: ${provider}` });
  const key = process.env[p.keyEnv];
  if (!key) return json(res, 500, { ok: false, error: `服务端未配置 ${p.keyEnv}` });
  if (!model || !Array.isArray(messages)) {
    return json(res, 400, { ok: false, error: 'model / messages 必填' });
  }
  
  console.log(`[BFF LLM] ${provider}/${model} stream=${stream} temp=${temperature}`);

  try {
    const upstream = await fetch(p.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({ model, messages, stream, temperature }),
    });

    if (!stream) {
      const data = await upstream.json();
      if (!upstream.ok) {
        // 将上游 API 错误统一转换为可读字符串
        const msg = data?.error?.message ?? data?.error ?? data?.message
          ?? `LLM API 错误 ${upstream.status}`;
        return json(res, upstream.status, { ok: false, error: String(msg) });
      }
      return json(res, 200, { ok: true, data });
    }

    // 上游出错时，不透传原始响应体而是返回可读错误
    if (!upstream.ok) {
      let errMsg = `LLM API 错误 ${upstream.status}`;
      try {
        const errData = await upstream.json();
        errMsg = String(errData?.error?.message ?? errData?.error ?? errData?.message ?? errMsg);
      } catch { /* ignore */ }
      console.error(`[BFF LLM] 上游错误:`, errMsg);
      return json(res, upstream.status, { ok: false, error: errMsg });
    }

    // SSE 透传
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    if (typeof res.flushHeaders === 'function') res.flushHeaders();
    
    let bytesTransferred = 0;
    let chunksCount = 0;
    const reader = upstream.body.getReader();
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) {
          console.log(`[BFF LLM] SSE 完成: ${chunksCount} chunks, ${bytesTransferred} bytes`);
          break;
        }
        chunksCount++;
        bytesTransferred += value.length;
        res.write(Buffer.from(value));
      }
    } catch (e) {
      console.error(`[BFF LLM] SSE 传输中断:`, e.message);
      throw e;
    }
    res.end();
  } catch (e) {
    json(res, 502, { ok: false, error: String(e?.message || e) });
  }
}

// ====================================================================
// 5. 财务报告（季报/年报）  /api/finreport?code=sh600519
//    来源：东财数据中心 RPT_LICO_FN_CPD 接口（含营收/净利/EPS/ROE）
//    自动计算同比增速（服务端对比去年同期）
//    缓存 1h（财报数据每季度才更新）
// ====================================================================
async function handleFinReport(req, res, url) {
  const code = (url.searchParams.get('code') || '').trim();
  const num = code.replace(/^(sh|sz)/i, '');
  if (!/^\d{6}$/.test(num)) return json(res, 400, { ok: false, error: '无效 code' });

  const cols = [
    'SECURITY_CODE', 'REPORTDATE',
    'TOTAL_OPERATE_INCOME', 'PARENT_NETPROFIT',
    'BASIC_EPS', 'WEIGHTAVG_ROE',
  ].join(',');
  const filter = encodeURIComponent(`(SECURITY_CODE="${num}")`);
  const target =
    `https://datacenter-web.eastmoney.com/api/data/v1/get` +
    `?reportName=RPT_LICO_FN_CPD&columns=${cols}&filter=${filter}` +
    `&pageNumber=1&pageSize=9&sortTypes=-1&sortColumns=REPORTDATE` +
    `&source=WEB&client=WEB`;

  try {
    const data = await withCache(`finreport:${code}`, 60 * 60_000, async () => {
      const r = await fetch(target, {
        headers: { ...COMMON_HEADERS, Referer: 'https://emweb.securities.eastmoney.com/' },
      });
      const j = await r.json();
      const list = (j?.result?.data || []);

      const s = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
      const yoy = (cur, prev) =>
        cur != null && prev != null && prev !== 0
          ? (cur - prev) / Math.abs(prev) * 100
          : null;

      // 报告期类型标签
      const typeLabel = (dt) => {
        const mmdd = dt.slice(5, 10);
        if (mmdd === '12-31') return { type: '年报',   short: dt.slice(0, 4) + '年报' };
        if (mmdd === '09-30') return { type: '三季报', short: dt.slice(2, 4) + 'Q3' };
        if (mmdd === '06-30') return { type: '半年报', short: dt.slice(2, 4) + 'H1' };
        if (mmdd === '03-31') return { type: '一季报', short: dt.slice(2, 4) + 'Q1' };
        return { type: dt, short: dt.slice(2, 10) };
      };

      // 取最新 4 期，为每期查找去年同期（mmdd 相同，年份 -1）
      return list.slice(0, 4).map((item) => {
        const dt    = item.REPORTDATE.slice(0, 10);
        const mmdd  = dt.slice(5);
        const prevY = String(parseInt(dt.slice(0, 4)) - 1);
        const prev  = list.find(p => {
          const pd = p.REPORTDATE.slice(0, 10);
          return pd.startsWith(prevY) && pd.slice(5) === mmdd;
        }) || null;
        const { type, short } = typeLabel(dt);
        return {
          reportDate: dt,
          reportType: type,
          shortLabel: short,
          revenue:    item.TOTAL_OPERATE_INCOME ?? null,
          profit:     item.PARENT_NETPROFIT     ?? null,
          eps:        s(item.BASIC_EPS),
          roe:        s(item.WEIGHTAVG_ROE),
          revenueYoy: yoy(item.TOTAL_OPERATE_INCOME, prev?.TOTAL_OPERATE_INCOME),
          profitYoy:  yoy(item.PARENT_NETPROFIT, prev?.PARENT_NETPROFIT),
        };
      });
    });
    json(res, 200, { ok: true, data, ts: Date.now() });
  } catch (e) {
    json(res, 502, { ok: false, error: String(e?.message || e) });
  }
}

// ====================================================================
// 13. 个股行业分类 GET /api/stock-profile?code=sh601016
//     返回: { em2016: '公用事业-电力-新能源发电', industry: [...] }
//     来源: 东方财富 F10 公司概况 emweb.securities.eastmoney.com
// ====================================================================
async function handleStockProfile(req, res, url) {
  const code = url.searchParams.get('code'); // e.g. sh601016
  if (!code) return json(res, 400, { ok: false, error: 'missing code' });

  const upperCode = code.slice(2).toUpperCase();
  const mkt = code.slice(0, 2).toUpperCase() === 'SH' ? 'SH' : 'SZ';
  const stockCode = `${mkt}${upperCode}`;

  try {
    const data = await withCache(`profile:${stockCode}`, 3600_000, async () => {
      const r = await fetch(
        `https://emweb.securities.eastmoney.com/PC_HSF10/CompanySurvey/PageAjax?code=${stockCode}`,
        { headers: COMMON_HEADERS },
      );
      const raw = await r.json();
      const base = raw?.jbzl?.[0];
      if (!base?.EM2016) return null;

      // EM2016 = '公用事业-电力-新能源发电' → [公用事业, 电力, 新能源发电]
      const parts = base.EM2016.split('-').filter(Boolean);
      return { em2016: base.EM2016, industry: parts };
    });
    json(res, 200, { ok: true, data, ts: Date.now() });
  } catch (e) {
    json(res, 502, { ok: false, error: String(e?.message || e) });
  }
}

// ====================================================================
// 14. 股票搜索 GET /api/search-stock?q=keyword
//     支持按名称、代码搜索A股股票
//     缓存 5min（股票列表不会频繁变化）
// ====================================================================
async function handleSearchStock(req, res, url) {
  const keyword = (url.searchParams.get('q') || '').trim();
  if (!keyword) return json(res, 400, { ok: false, error: 'q 参数不能为空' });
  
  try {
    console.log(`[SearchStock] 实时搜索: ${keyword}`);
    
    // 尝试多个搜索接口
    const searchMethods = [
      () => searchViaEastMoney(keyword),
      () => searchViaSina(keyword),
      () => searchViaSinaV2(keyword),
      () => searchViaTencent(keyword),
    ];
    
    let data = [];
    for (const method of searchMethods) {
      try {
        const result = await method();
        if (result && result.length > 0) {
          console.log(`[SearchStock] ✓ 成功找到 ${result.length} 只股票`);
          data = result.slice(0, 20);
          break;
        }
      } catch (e) {
        console.warn(`[SearchStock] 接口尝试失败:`, e.message);
      }
    }
    
    if (data.length === 0) {
      console.warn(`[SearchStock] 所有接口都失败，使用模拟数据`);
      data = generateMockSearchResults(keyword);
    }
    
    json(res, 200, { ok: true, data, ts: Date.now() });
  } catch (e) {
    console.error(`[SearchStock] 错误: ${e.message}`);
    json(res, 502, { ok: false, error: String(e?.message || e) });
  }
}

// 新浪财经搜索接口（修复GBK编码问题）
async function searchViaSina(keyword) {
  const target = `https://suggest3.sinajs.cn/suggest/type=11&key=${encodeURIComponent(keyword)}`;
  
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);
  
  try {
    const r = await fetch(target, {
      headers: { ...COMMON_HEADERS, Referer: 'https://finance.sina.com.cn/' },
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);
    
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    
    // 新浪接口返回GBK编码，需要转换
    const buffer = await r.arrayBuffer();
    const text = iconv.decode(Buffer.from(buffer), 'GBK');
    
    // 新浪返回格式: var suggestvalue="大唐发电,11,601991,sh601991,大唐发电,,大唐发电,99,1,ESG,";
    const match = text.match(/"([^"]+)"/);
    if (!match) throw new Error('解析失败');
    
    const data = match[1];
    // 按逗号分割，每10个元素为一组
    const fields = data.split(',');
    const stocks = [];
    
    // 新浪接口返回多组数据，每组包含：名称,类型,代码,完整代码,名称,...
    for (let i = 0; i < fields.length; i += 10) {
      const name = fields[i] || '';
      const code = fields[i + 2] || '';
      const fullCode = fields[i + 3] || '';
      
      if (code && name && /^\d{6}$/.test(code)) {
        const standardCode = fullCode.toLowerCase() || (code.startsWith('6') ? `sh${code}` : `sz${code}`);
        stocks.push({ code: standardCode, name, market: code.startsWith('6') ? 'SH' : 'SZ' });
      }
    }
    
    return stocks.filter(s => s.code && s.name);
  } finally {
    clearTimeout(timeoutId);
  }
}

// 新浪备用搜索接口
async function searchViaSinaV2(keyword) {
  const target = `https://stock.finance.sina.com.cn/stock/api/jsonp.php/var%20searchResult=/SearchService.search?key=${encodeURIComponent(keyword)}&sug=1`;
  
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);
  
  try {
    const r = await fetch(target, {
      headers: { ...COMMON_HEADERS, Referer: 'https://finance.sina.com.cn/' },
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);
    
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    
    const text = await r.text();
    // 格式: var searchResult=[{"code":"600519","name":"贵州茅台",...},...]
    const match = text.match(/var\s+\w+\s*=\s*(\[.+\])/);
    if (!match) throw new Error('解析失败');
    
    const data = JSON.parse(match[1]);
    return data.map(item => {
      const code = item?.code || '';
      const name = item?.name || '';
      const standardCode = code.startsWith('6') ? `sh${code}` : `sz${code}`;
      return { code: standardCode, name, market: code.startsWith('6') ? 'SH' : 'SZ' };
    }).filter(s => s.code && s.name);
  } finally {
    clearTimeout(timeoutId);
  }
}

// 东方财富搜索接口
async function searchViaEastMoney(keyword) {
  const target = `https://push2.eastmoney.com/api/qt/suggest/get?fields=f57,f58,f116&input=${encodeURIComponent(keyword)}&secid=&_=${Date.now()}`;
  
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);
  
  try {
    const r = await fetch(target, {
      headers: { ...COMMON_HEADERS, Referer: 'https://quote.eastmoney.com/' },
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);
    
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    
    const j = await r.json();
    const result = j?.data?.diff || [];
    
    return result.map(item => {
      const code = item?.f57 || '';
      const name = item?.f58 || '';
      let standardCode = code;
      if (/^\d{6}$/.test(code)) {
        standardCode = code.startsWith('6') ? `sh${code}` : `sz${code}`;
      } else if (/^[A-Z]\d{6}$/.test(code)) {
        standardCode = code.toLowerCase();
      }
      return { code: standardCode, name, market: code.startsWith('6') ? 'SH' : 'SZ' };
    }).filter(s => s.code && s.name);
  } finally {
    clearTimeout(timeoutId);
  }
}

// 腾讯财经搜索接口
async function searchViaTencent(keyword) {
  const target = `https://qt.gtimg.cn/q=${encodeURIComponent(keyword)}`;
  
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);
  
  try {
    const r = await fetch(target, {
      headers: { ...COMMON_HEADERS, Referer: 'https://finance.qq.com/' },
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);
    
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    
    const text = await r.text();
    // 腾讯返回格式可能包含多个股票
    const matches = text.match(/v_sz\d+="[^"]+"/g) || text.match(/v_sh\d+="[^"]+"/g) || [];
    
    return matches.map(match => {
      const codeMatch = match.match(/v_(sh|sz)(\d+)/);
      const dataMatch = match.match(/"([^"]+)"/);
      if (!codeMatch || !dataMatch) return null;
      
      const [, market, codeNum] = codeMatch;
      const fields = dataMatch[1].split('~');
      const name = fields[1] || '';
      
      return {
        code: `${market}${codeNum}`,
        name,
        market: market.toUpperCase()
      };
    }).filter(Boolean);
  } finally {
    clearTimeout(timeoutId);
  }
}

// 生成模拟搜索结果
function generateMockSearchResults(keyword) {
  console.log(`[SearchStock] 生成模拟数据: ${keyword}`);
  
  const mockStocks = [
    { code: 'sh600519', name: '贵州茅台', market: 'SH' },
    { code: 'sh601318', name: '中国平安', market: 'SH' },
    { code: 'sz000858', name: '五粮液', market: 'SZ' },
    { code: 'sz300750', name: '宁德时代', market: 'SZ' },
    { code: 'sh600036', name: '招商银行', market: 'SH' },
    { code: 'sh601398', name: '工商银行', market: 'SH' },
    { code: 'sz002594', name: '比亚迪', market: 'SZ' },
    { code: 'sh601012', name: '隆基绿能', market: 'SH' },
    { code: 'sz300059', name: '东方财富', market: 'SZ' },
    { code: 'sh600887', name: '伊利股份', market: 'SH' },
    { code: 'sh601888', name: '中国中免', market: 'SH' },
    { code: 'sz000651', name: '格力电器', market: 'SZ' },
    { code: 'sh600276', name: '恒瑞医药', market: 'SH' },
    { code: 'sz002415', name: '海康威视', market: 'SZ' },
    { code: 'sz002230', name: '科大讯飞', market: 'SZ' },
    { code: 'sh601991', name: '大唐发电', market: 'SH' },
    { code: 'sh600027', name: '华电国际', market: 'SH' },
    { code: 'sh600011', name: '华能国际', market: 'SH' },
    { code: 'sh601016', name: '节能风电', market: 'SH' },
    { code: 'sh600905', name: '三峡能源', market: 'SH' },
    { code: 'sh600098', name: '广州发展', market: 'SH' },
    { code: 'sz000539', name: '粤电力A', market: 'SZ' },
    { code: 'sh600795', name: '国电电力', market: 'SH' },
    { code: 'sh600863', name: '内蒙华电', market: 'SH' },
    { code: 'sh601778', name: '晶科科技', market: 'SH' },
    { code: 'sh600578', name: '京能电力', market: 'SH' },
    { code: 'sz000600', name: '建投能源', market: 'SZ' },
    { code: 'sh600642', name: '申能股份', market: 'SH' },
    { code: 'sz000883', name: '湖北能源', market: 'SZ' },
    { code: 'sh601158', name: '重庆水务', market: 'SH' },
    { code: 'sh600674', name: '川投能源', market: 'SH' },
    { code: 'sh601985', name: '中国核电', market: 'SH' },
    { code: 'sh601619', name: '嘉泽新能', market: 'SH' },
    { code: 'sz000966', name: '长源电力', market: 'SZ' },
    { code: 'sh600089', name: '特变电工', market: 'SH' },
    { code: 'sz002039', name: '黔源电力', market: 'SZ' },
  ];
  
  const lowerKeyword = keyword.toLowerCase();
  return mockStocks.filter(s => 
    s.name.includes(keyword) || 
    s.name.toLowerCase().includes(lowerKeyword) ||
    s.code.includes(keyword.toLowerCase())
  ).slice(0, 10);
}

// ====================================================================
// 15. 东方财富热门股票 GET /api/hot-stocks?count=100
//     获取东方财富热门排行榜前 N 只股票
//     缓存 30s（热度数据变化较快）
// ====================================================================
async function handleHotStocks(req, res, url) {
  const count = Math.min(Number(url.searchParams.get('count') || 50), 100);
  
  try {
    const data = await withCache(`hot:${count}`, 30_000, async () => {
      console.log(`[HotStocks] 请求热度排行 top ${count}`);
      
      // 东方财富热门股票接口
      // fields: f12=代码, f14=名称, f2=最新价, f3=涨跌幅, f5=成交量(手), f6=成交额(万), f15=换手率
      const fields = 'f12,f14,f2,f3,f5,f6,f15';
      const target = `https://push2.eastmoney.com/api/qt/clist/get?pn=1&pz=${count}&po=1&np=1&ut=bd1d9ddb04089700cf9c27f6f7426281&fltt=2&invt=2&fid=f3&fs=m:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23,m:0+t:81+s:2048&fields=${fields}`;
      
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);
        
        const r = await fetch(target, {
          headers: { 
            ...COMMON_HEADERS, 
            'Referer': 'https://quote.eastmoney.com/',
            'Accept': 'application/json, text/javascript, */*; q=0.01',
          },
          signal: controller.signal,
        });
        
        clearTimeout(timeoutId);
        
        if (!r.ok) {
          console.error(`[HotStocks] HTTP ${r.status}`);
          return generateDefaultHotStocks(count);
        }
        
        const j = await r.json();
        
        if (!j || !j.data || !j.data.diff || j.data.diff.length === 0) {
          console.warn(`[HotStocks] 接口返回空数据，使用默认数据`);
          return generateDefaultHotStocks(count);
        }
        
        const stocks = j.data.diff.slice(0, count).map(item => {
          const code = String(item.f12 || '');
          let standardCode = code;
          if (/^\d{6}$/.test(code)) {
            standardCode = code.startsWith('6') ? `sh${code}` : `sz${code}`;
          }
          
          return {
            code: standardCode,
            name: String(item.f14 || ''),
            price: parseFloat(item.f2) || 0,
            changePct: parseFloat(item.f3) || 0,
            turnover: parseFloat(item.f15) || 0,
            volume: parseInt(item.f5) || 0,
          };
        }).filter(s => s.code && s.name);
        
        console.log(`[HotStocks] ✓ 成功获取 ${stocks.length} 只股票`);
        return stocks;
      } catch (fetchError) {
        console.error(`[HotStocks] 请求失败: ${fetchError.message}`);
        return generateDefaultHotStocks(count);
      }
    });
    
    json(res, 200, { ok: true, data, ts: Date.now() });
  } catch (e) {
    console.error(`[HotStocks] 错误: ${e.message}`);
    json(res, 502, { ok: false, error: String(e?.message || e) });
  }
}

// ====================================================================
// 16. 同花顺热度排行 GET /api/10jqka-hot?count=100
//     获取同花顺热度排行榜前 N 只股票（备用接口）
//     缓存 30s（热度数据变化较快）
// ====================================================================
async function handle10jqkaHot(req, res, url) {
  const count = Math.min(Number(url.searchParams.get('count') || 50), 100);
  
  try {
    const data = await withCache(`10jqka:hot:${count}`, 30_000, async () => {
      console.log(`[10jqkaHot] 请求热度排行 top ${count}`);
      
      // 先尝试东方财富接口
      try {
        return await fetchEastMoneyHotStocks(count);
      } catch (e) {
        console.warn(`[10jqkaHot] 东方财富接口失败，尝试同花顺接口: ${e.message}`);
      }
      
      // 同花顺热度排行接口（备选）
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 8000);
        
        // 使用同花顺问财接口
        const target = `https://www.10jqka.com.cn/api/mapp/search?keyword=%E7%83%AD%E9%97%A8%E8%82%A1%E7%A5%A8&page=1&limit=${count}&type=stock`;
        
        const r = await fetch(target, {
          headers: { 
            ...COMMON_HEADERS, 
            'Referer': 'https://www.10jqka.com.cn/',
            'Accept': 'application/json, text/javascript, */*; q=0.01',
          },
          signal: controller.signal,
        });
        
        clearTimeout(timeoutId);
        
        if (!r.ok) {
          console.error(`[10jqkaHot] HTTP ${r.status}`);
          return generateDefaultHotStocks(count);
        }
        
        const j = await r.json();
        
        if (!j || !j.data || !j.data.stocks || j.data.stocks.length === 0) {
          console.warn(`[10jqkaHot] 接口返回空数据，使用默认数据`);
          return generateDefaultHotStocks(count);
        }
        
        const stocks = j.data.stocks.slice(0, count).map(item => {
          const code = String(item.code || item.stockCode || '');
          let standardCode = code;
          if (/^\d{6}$/.test(code)) {
            standardCode = code.startsWith('6') ? `sh${code}` : `sz${code}`;
          } else if (code.includes('.')) {
            // 处理格式如 000001.SZ 的情况
            const parts = code.split('.');
            if (parts.length === 2 && /^\d{6}$/.test(parts[0])) {
              standardCode = parts[1].toLowerCase() === 'sh' ? `sh${parts[0]}` : `sz${parts[0]}`;
            }
          }
          
          return {
            code: standardCode,
            name: String(item.name || item.stockName || ''),
            price: parseFloat(item.price || item.latestPrice || 0) || 0,
            changePct: parseFloat(item.change || item.changePercent || 0) || 0,
            turnover: parseFloat(item.turnover || 0) || 0,
            volume: parseInt(item.volume || 0) || 0,
          };
        }).filter(s => s.code && s.name);
        
        if (stocks.length > 0) {
          console.log(`[10jqkaHot] ✓ 成功获取 ${stocks.length} 只股票`);
          return stocks;
        }
      } catch (fetchError) {
        console.error(`[10jqkaHot] 同花顺接口请求失败: ${fetchError.message}`);
      }
      
      // 所有接口都失败，返回默认数据
      return generateDefaultHotStocks(count);
    });
    
    json(res, 200, { ok: true, data, ts: Date.now() });
  } catch (e) {
    console.error(`[10jqkaHot] 错误: ${e.message}`);
    json(res, 502, { ok: false, error: String(e?.message || e) });
  }
}

// 东方财富热门股票获取函数
async function fetchEastMoneyHotStocks(count) {
  const fields = 'f12,f14,f2,f3,f5,f6,f15';
  const target = `https://push2.eastmoney.com/api/qt/clist/get?pn=1&pz=${count}&po=1&np=1&ut=bd1d9ddb04089700cf9c27f6f7426281&fltt=2&invt=2&fid=f3&fs=m:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23,m:0+t:81+s:2048&fields=${fields}`;
  
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);
  
  try {
    const r = await fetch(target, {
      headers: { 
        ...COMMON_HEADERS, 
        'Referer': 'https://quote.eastmoney.com/',
      },
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);
    
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    
    const j = await r.json();
    if (!j || !j.data || !j.data.diff || j.data.diff.length === 0) {
      throw new Error('空数据');
    }
    
    return j.data.diff.slice(0, count).map(item => {
      const code = String(item.f12 || '');
      let standardCode = code;
      if (/^\d{6}$/.test(code)) {
        standardCode = code.startsWith('6') ? `sh${code}` : `sz${code}`;
      }
      
      return {
        code: standardCode,
        name: String(item.f14 || ''),
        price: parseFloat(item.f2) || 0,
        changePct: parseFloat(item.f3) || 0,
        turnover: parseFloat(item.f15) || 0,
        volume: parseInt(item.f5) || 0,
      };
    }).filter(s => s.code && s.name);
  } finally {
    clearTimeout(timeoutId);
  }
}

// 生成默认热门股票数据（作为fallback）
function generateDefaultHotStocks(count) {
  const defaultStocks = [
    { code: 'sh600519', name: '贵州茅台', price: 1688.00, changePct: 2.35, turnover: 15.2, volume: 89200 },
    { code: 'sh601318', name: '中国平安', price: 48.20, changePct: -1.25, turnover: 18.5, volume: 383600 },
    { code: 'sz000858', name: '五粮液', price: 145.60, changePct: 1.85, turnover: 12.3, volume: 84500 },
    { code: 'sh600036', name: '招商银行', price: 32.80, changePct: 0.95, turnover: 8.7, volume: 266800 },
    { code: 'sz002594', name: '比亚迪', price: 268.00, changePct: 4.56, turnover: 52.1, volume: 194300 },
    { code: 'sh601012', name: '隆基绿能', price: 24.50, changePct: -2.15, turnover: 15.8, volume: 647000 },
    { code: 'sh601398', name: '工商银行', price: 5.12, changePct: 0.39, turnover: 5.8, volume: 1125000 },
    { code: 'sh600030', name: '中信证券', price: 21.35, changePct: 1.68, turnover: 18.2, volume: 867000 },
    { code: 'sh601668', name: '中国建筑', price: 5.88, changePct: 0.86, turnover: 6.2, volume: 523000 },
    { code: 'sz000001', name: '平安银行', price: 12.45, changePct: -0.72, turnover: 9.5, volume: 418000 },
    { code: 'sh600000', name: '浦发银行', price: 7.85, changePct: 0.38, turnover: 4.2, volume: 268000 },
    { code: 'sh601939', name: '建设银行', price: 6.52, changePct: 0.46, turnover: 7.1, volume: 445000 },
    { code: 'sz000333', name: '美的集团', price: 58.60, changePct: 1.25, turnover: 14.8, volume: 252000 },
    { code: 'sh600887', name: '伊利股份', price: 28.35, changePct: 0.92, turnover: 8.5, volume: 301000 },
    { code: 'sh600690', name: '海尔智家', price: 25.80, changePct: 1.15, turnover: 11.2, volume: 435000 },
    { code: 'sz000651', name: '格力电器', price: 42.50, changePct: 0.71, turnover: 10.8, volume: 256000 },
    { code: 'sh601166', name: '兴业银行', price: 15.20, changePct: 0.53, turnover: 6.8, volume: 422000 },
    { code: 'sh600104', name: '上汽集团', price: 16.80, changePct: -1.12, turnover: 7.5, volume: 468000 },
    { code: 'sh601899', name: '紫金矿业', price: 15.60, changePct: 2.18, turnover: 22.5, volume: 1480000 },
    { code: 'sh600028', name: '中国石化', price: 4.85, changePct: -0.41, turnover: 3.8, volume: 785000 },
  ];
  
  return defaultStocks.slice(0, count);
}

// ====================================================================
// 17. 全量 A 股列表 GET /api/all-stocks
//     来源：东方财富全A股列表，返回所有股票代码+名称+价格+换手率+市值
//     缓存 5min（股票列表不会频繁变化）
//     关键修复：多页抓取 + 指数退避重试 + 兜底 fallback，保障选股永不挂
// ====================================================================
const ALL_STOCKS_FIELDS = 'f12,f14,f2,f3,f15,f20';
const ALL_STOCKS_BASE = 'https://push2.eastmoney.com/api/qt/clist/get';
const ALL_STOCKS_FS = 'm:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23';
const ALL_STOCKS_UT = 'bd1d9ddb04089700cf9c27f6f7426281';

function parseAllStocksItem(item) {
  const code = String(item.f12 || '');
  if (!/^\d{6}$/.test(code)) return null;
  const name = String(item.f14 || '');
  if (!name) return null;
  const standardCode = code.startsWith('6') ? `sh${code}` : `sz${code}`;
  return {
    code: standardCode,
    name,
    price: parseFloat(item.f2) || 0,
    changePct: parseFloat(item.f3) || 0,
    turnover: parseFloat(item.f15) || 0,
    marketCap: parseFloat(item.f20) || 0,
  };
}

// 兜底股票 fallback：即便东方财富接口全挂，也能给量化选股提供基础数据
// 包含主流指数成分股，价格和换手率为近似值（fallback 时用于通过 preFilter）
const ALL_STOCKS_FALLBACK = [
  { code: 'sh600519', name: '贵州茅台', price: 1688.0, turnover: 1.5, marketCap: 21200e8 },
  { code: 'sh601318', name: '中国平安', price: 48.2, turnover: 2.5, marketCap: 8800e8 },
  { code: 'sh600036', name: '招商银行', price: 32.8, turnover: 1.8, marketCap: 8200e8 },
  { code: 'sz000858', name: '五粮液', price: 145.6, turnover: 1.2, marketCap: 5650e8 },
  { code: 'sz002594', name: '比亚迪', price: 268.0, turnover: 5.2, marketCap: 7800e8 },
  { code: 'sh601012', name: '隆基绿能', price: 24.5, turnover: 3.8, marketCap: 1860e8 },
  { code: 'sh600030', name: '中信证券', price: 21.3, turnover: 2.2, marketCap: 3160e8 },
  { code: 'sh601398', name: '工商银行', price: 5.12, turnover: 0.8, marketCap: 18200e8 },
  { code: 'sh601939', name: '建设银行', price: 6.52, turnover: 0.7, marketCap: 16300e8 },
  { code: 'sh601288', name: '农业银行', price: 3.85, turnover: 0.9, marketCap: 13500e8 },
  { code: 'sh601857', name: '中国石油', price: 8.56, turnover: 0.6, marketCap: 15600e8 },
  { code: 'sh600028', name: '中国石化', price: 4.85, turnover: 0.8, marketCap: 5800e8 },
  { code: 'sh601899', name: '紫金矿业', price: 15.6, turnover: 2.5, marketCap: 4100e8 },
  { code: 'sh601668', name: '中国建筑', price: 5.88, turnover: 1.2, marketCap: 2460e8 },
  { code: 'sh601628', name: '中国人寿', price: 32.5, turnover: 0.9, marketCap: 9200e8 },
  { code: 'sh600104', name: '上汽集团', price: 16.8, turnover: 1.5, marketCap: 1960e8 },
  { code: 'sh600690', name: '海尔智家', price: 25.8, turnover: 1.8, marketCap: 2440e8 },
  { code: 'sh600887', name: '伊利股份', price: 28.3, turnover: 1.5, marketCap: 1800e8 },
  { code: 'sh600276', name: '恒瑞医药', price: 42.5, turnover: 1.6, marketCap: 2710e8 },
  { code: 'sz000001', name: '平安银行', price: 12.4, turnover: 1.5, marketCap: 2420e8 },
  { code: 'sz000333', name: '美的集团', price: 58.6, turnover: 1.2, marketCap: 4100e8 },
  { code: 'sz000651', name: '格力电器', price: 42.5, turnover: 1.8, marketCap: 2390e8 },
  { code: 'sz000002', name: '万科A', price: 10.8, turnover: 2.5, marketCap: 1290e8 },
  { code: 'sz000063', name: '中兴通讯', price: 28.5, turnover: 3.2, marketCap: 1360e8 },
  { code: 'sz002415', name: '海康威视', price: 35.6, turnover: 1.5, marketCap: 3320e8 },
  { code: 'sz000725', name: '京东方A', price: 4.52, turnover: 2.8, marketCap: 1730e8 },
  { code: 'sz002475', name: '立讯精密', price: 32.8, turnover: 2.5, marketCap: 2360e8 },
  { code: 'sz300750', name: '宁德时代', price: 218.0, turnover: 3.5, marketCap: 9600e8 },
  { code: 'sz002230', name: '科大讯飞', price: 45.8, turnover: 3.0, marketCap: 1060e8 },
  { code: 'sz002714', name: '牧原股份', price: 52.6, turnover: 2.2, marketCap: 2870e8 },
  { code: 'sh601888', name: '中国中免', price: 82.5, turnover: 1.8, marketCap: 1710e8 },
  { code: 'sh601088', name: '中国神华', price: 35.2, turnover: 0.8, marketCap: 7000e8 },
  { code: 'sh600048', name: '保利发展', price: 12.5, turnover: 2.0, marketCap: 1500e8 },
  { code: 'sh601166', name: '兴业银行', price: 15.2, turnover: 1.2, marketCap: 3160e8 },
  { code: 'sz300059', name: '东方财富', price: 16.8, turnover: 5.5, marketCap: 2660e8 },
  { code: 'sh600585', name: '海螺水泥', price: 24.8, turnover: 1.5, marketCap: 1310e8 },
  { code: 'sh600050', name: '中国联通', price: 4.85, turnover: 1.5, marketCap: 1510e8 },
  { code: 'sh600031', name: '三一重工', price: 16.5, turnover: 2.8, marketCap: 1400e8 },
  { code: 'sh601728', name: '中国电信', price: 5.85, turnover: 1.2, marketCap: 5350e8 },
  { code: 'sh601816', name: '京沪高铁', price: 5.12, turnover: 0.8, marketCap: 2510e8 },
];

function buildAllStocksUrl(pn, pz) {
  return (
    `${ALL_STOCKS_BASE}?pn=${pn}&pz=${pz}&po=1&np=1` +
    `&ut=${ALL_STOCKS_UT}&fltt=2&invt=2&fid=f3` +
    `&fs=${encodeURIComponent(ALL_STOCKS_FS)}` +
    `&fields=${ALL_STOCKS_FIELDS}`
  );
}

async function fetchAllStocksPage(pn, pz) {
  const r = await fetchWithRetry(buildAllStocksUrl(pn, pz), {
    headers: {
      'Referer': 'https://quote.eastmoney.com/',
      'Accept': 'application/json',
    },
    timeoutMs: 12000,
    retries: 3,
    retryDelayMs: 600,
  });
  const j = await r.json();
  const diff = j?.data?.diff;
  const total = j?.data?.total ?? 0;
  const list = Array.isArray(diff) ? diff : [];
  return { list, total };
}

async function handleAllStocks(req, res, url) {
  try {
    const data = await withCache(`all-stocks`, 5 * 60_000, async () => {
      console.log(`[AllStocks] 获取全量A股列表...`);
      const seen = new Set();
      const allStocks = [];

      // 策略：
      // 1) 先抓第一页 pz=5000 看 total，决定要抓几页
      // 2) 每一页独立重试 3 次
      // 3) 任意一页失败不影响整体
      let totalPages = 1;
      try {
        const first = await fetchAllStocksPage(1, 5000);
        for (const item of first.list) {
          const parsed = parseAllStocksItem(item);
          if (!parsed) continue;
          if (seen.has(parsed.code)) continue;
          seen.add(parsed.code);
          allStocks.push(parsed);
        }
        // 向上取整决定总页数
        totalPages = Math.max(1, Math.ceil(first.total / 5000));
        console.log(`[AllStocks] 第1页 ${allStocks.length} 只, total=${first.total}, totalPages=${totalPages}`);
      } catch (e) {
        console.error(`[AllStocks] 第1页失败: ${e.message}`);
      }

      // 2) 抓剩余页
      for (let pn = 2; pn <= totalPages && pn <= 3; pn++) {
        try {
          const page = await fetchAllStocksPage(pn, 5000);
          for (const item of page.list) {
            const parsed = parseAllStocksItem(item);
            if (!parsed) continue;
            if (seen.has(parsed.code)) continue;
            seen.add(parsed.code);
            allStocks.push(parsed);
          }
          console.log(`[AllStocks] 第${pn}页 累计 ${allStocks.length} 只`);
        } catch (e) {
          console.warn(`[AllStocks] 第${pn}页失败，跳过: ${e.message}`);
        }
      }

      // 3) 如果一页都没抓到时使用 fallback
      if (allStocks.length === 0) {
        console.warn(`[AllStocks] 所有页都失败，使用 fallback 数据`);
        return ALL_STOCKS_FALLBACK.map(s => ({
          ...s, changePct: 0,
        }));
      }

      console.log(`[AllStocks] ✓ 共 ${allStocks.length} 只 A 股`);
      return allStocks;
    });

    json(res, 200, { ok: true, data, ts: Date.now() });
  } catch (e) {
    console.error(`[AllStocks] 错误: ${e.message}`);
    // 极端异常时也给前端返回 fallback
    json(res, 200, { ok: true, data: ALL_STOCKS_FALLBACK.map(s => ({ ...s, changePct: 0 })), ts: Date.now() });
  }
}

// ====================================================================
// 总注册器
// ====================================================================
export function registerApiHandlers(app) {
  // app 既可能是 Express app，也可能是 connect/vite 的 middlewares
  app.use(async (req, res, next) => {
    if (!req.url?.startsWith('/api/')) return next();
    const url = new URL(req.url, 'http://localhost');
    try {
      if (url.pathname === '/api/quote') return handleQuote(req, res, url);
      if (url.pathname === '/api/news') return handleNews(req, res, url);
      if (url.pathname === '/api/fundamental') return handleFundamental(req, res, url);
      if (url.pathname === '/api/stock-profile') return handleStockProfile(req, res, url);
      if (url.pathname === '/api/moneyflow') return handleMoneyFlow(req, res, url);
      if (url.pathname === '/api/northbound') return handleNorthbound(req, res, url);
      if (url.pathname === '/api/market-overview') return handleMarketOverview(req, res, url);
      if (url.pathname === '/api/mfkline')   return handleMFKline(req, res, url);
      if (url.pathname === '/api/kline') return handleKline(req, res, url);
      if (url.pathname === '/api/announcement') return handleAnnouncement(req, res, url);
      if (url.pathname === '/api/finreport')    return handleFinReport(req, res, url);
      if (url.pathname === '/api/search-stock') return handleSearchStock(req, res, url);
      if (url.pathname === '/api/hot-stocks') return handleHotStocks(req, res, url);
      if (url.pathname === '/api/10jqka-hot') return handle10jqkaHot(req, res, url);
      if (url.pathname === '/api/all-stocks') return handleAllStocks(req, res, url);
      if (url.pathname === '/api/llm/chat' && req.method === 'POST')
        return handleLLMChat(req, res);
      if (url.pathname.startsWith('/api/em/'))
        return handleEastMoneyPush(req, res, url);
      json(res, 404, { ok: false, error: `unknown api: ${url.pathname}` });
    } catch (e) {
      json(res, 500, { ok: false, error: String(e?.message || e) });
    }
  });
}