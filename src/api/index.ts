import { api, apiEnv } from '@/lib/request';
import type { Announcement, FinReport, Fundamental, KlineBar, MFKlineBar, MoneyFlow, NewsItem, Quote } from '@/types';

/** 实时报价（新浪财经）*/
export const fetchQuotes = (codes: string[]) =>
  apiEnv<Quote[]>(`/api/quote?symbols=${codes.join(',')}`);

/** 7x24 财经快讯（东方财富）*/
export const fetchNews = (count = 20) =>
  apiEnv<NewsItem[]>(`/api/news?count=${count}`);

/** 个股所属行业（东方财富 F10 公司概况 EM2016 字段）*/
export const fetchStockProfile = (code: string) =>
  apiEnv<{ em2016: string; industry: string[] }>(`/api/stock-profile?code=${code}`);

/** 个股基本面快照：PE/PB/ROE/市值等（东方财富）*/
export const fetchFundamental = (code: string) =>
  apiEnv<Fundamental>(`/api/fundamental?code=${code}`);

/** 今日主力/大单/小单净流入（东方财富）*/
export const fetchMoneyFlow = (code: string) =>
  apiEnv<MoneyFlow>(`/api/moneyflow?code=${code}`);

/** 近 N 日主力资金流向日线（东方财富历史接口）*/
export const fetchMFKline = (code: string, days = 10) =>
  apiEnv<MFKlineBar[]>(`/api/mfkline?code=${code}&days=${days}`);

/**
 * 前复权日 K 线数据（东方财富）
 * @param code  新浪格式代码，如 sh600519
 * @param days  返回最近 N 根日 K，最大 250，默认 60
 */
export const fetchKline = (code: string, days = 60) =>
  apiEnv<KlineBar[]>(`/api/kline?code=${code}&days=${days}`);

/**
 * 近期重要公告（东方财富，来自交易所正式披露）
 * @param code  新浪格式代码
 * @param count 返回条数，默认 5
 */
export const fetchAnnouncements = (code: string, count = 5) =>
  apiEnv<Announcement[]>(`/api/announcement?code=${code}&count=${count}`);

/** 近期财务报告（季报/年报）含同比增速，最近 4 期 */
export const fetchFinReport = (code: string) =>
  apiEnv<FinReport[]>(`/api/finreport?code=${code}`);

/** 热门股票排行榜（东方财富）*/
export const fetchHotStocks = (count = 50) =>
  apiEnv<{ code: string; name: string; changePct: number; price: number; turnover: number; volume: number }[]>(
    `/api/hot-stocks?count=${count}`
  );

/** 同花顺热度排行榜 */
export const fetch10jqkaHotStocks = (count = 100) =>
  apiEnv<{ code: string; name: string; changePct: number; price: number; turnover: number; volume: number }[]>(
    `/api/10jqka-hot?count=${count}`
  );

/** 全量 A 股列表（东方财富，5000+只） */
export const fetchAllStocks = () =>
  apiEnv<{ code: string; name: string; price: number; changePct: number; turnover: number; marketCap: number }[]>(
    `/api/all-stocks`
  );

/** 北向资金整体实时流向（沪股通+深股通净流入） */
export const fetchNorthboundFlow = () =>
  apiEnv<{
    shBuy: number | null; shSell: number | null;
    szBuy: number | null; szSell: number | null;
    totalNet: number | null; updateTime: string | null;
  }>(`/api/northbound`);

/** 市场概览（今日成交额、北向资金） */
export const fetchMarketOverview = () =>
  apiEnv<{
    shAmount: number; szAmount: number; totalAmount: number;
    yestAmount: number;
    shChangePct: number; szChangePct: number;
    northNet: number | null; updateTime: string;
  }>(`/api/market-overview`);

// ── LLM 调用 ────────────────────────────────────────────────

type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

/** 非流式 LLM 调用（JSON 修复重试等场景使用）*/
export async function chatLLM(opts: {
  provider: 'deepseek' | 'qwen';
  model: string;
  messages: ChatMessage[];
  temperature?: number;
}): Promise<string> {
  const r = await fetch('/api/llm/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...opts, stream: false }),
  });
  const j = await r.json();
  if (!j.ok) {
    // BFF 返回 {ok:false, error:"..."}，范围外错误在 j.data 中
    const errMsg = j.error
      ?? (typeof j.data?.error === 'string' ? j.data.error : j.data?.error?.message)
      ?? j.data?.message
      ?? 'LLM 调用失败';
    throw new Error(String(errMsg));
  }
  const content =
    j.data?.choices?.[0]?.message?.content ?? j.data?.choices?.[0]?.text ?? '';
  if (!content) throw new Error('模型返回为空');
  return content;
}

/**
 * 流式 LLM 调用。
 * 兼容 OpenAI/DeepSeek/Qwen SSE 协议：data: {choices:[{delta:{content:"..."}}]}
 *
 * @param opts.signal  AbortController.signal，用于停止生成
 * @param onDelta      每次收到新文本片段时回调（deltaText, fullText）
 * @returns            完整输出文本
 */
export async function chatLLMStream(
  opts: {
    provider: 'deepseek' | 'qwen';
    model: string;
    messages: ChatMessage[];
    temperature?: number;
    signal?: AbortSignal;
  },
  onDelta: (deltaText: string, fullText: string) => void,
): Promise<string> {
  const { signal, ...rest } = opts;
  
  const r = await fetch('/api/llm/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...rest, stream: true }),
    signal,
  });

  if (!r.ok || !r.body) {
    let msg = `LLM 流式调用失败 ${r.status}`;
    try {
      const errJson = await r.json();
      const e = errJson.error;
      msg = (typeof e === 'string' ? e : e?.message) ?? errJson.message ?? msg;
    } catch { /* ignore */ }
    throw new Error(String(msg));
  }

  const reader  = r.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buf  = '';
  let full = '';

  try {
    while (true) {
      const { value, done } = await reader.read();
      
      if (done) {
        break;
      }
      
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const payload = trimmed.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;
        
        try {
          const parsed = JSON.parse(payload);
          const delta = parsed?.choices?.[0]?.delta?.content ?? '';
          if (delta) {
            full += delta;
            onDelta(delta, full);
          }
        } catch {
          continue;
        }
      }
    }
  } catch (e) {
    if (full.length > 0) {
      return full;
    }
    throw e;
  }
  
  return full;
}

// 防止 tree-shake 警告（api 工具函数在其他模块未直接引用时）
void api;