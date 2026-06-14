export interface Quote {
  code: string;
  name: string;
  open: number;
  prevClose: number;
  price: number;
  high: number;
  low: number;
  volume: number;
  amount: number;
  change: number;
  changePct: number;
  date: string;
  time: string;
  valid: boolean;
}

export interface NewsItem {
  id: string;
  title: string;
  summary?: string;
  time: string;
  url?: string;
  tags?: string[];
}

export interface Fundamental {
  code: string;
  name: string;
  price: number | null;
  prevClose: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  changePct: number | null;
  change: number | null;
  volume: number | null;
  amount: number | null;
  turnover: number | null;    // 换手率 %
  volumeRatio: number | null; // 量比
  eps: number | null;
  peDyn: number | null;
  peStatic: number | null;
  peTTM: number | null;
  pb: number | null;
  totalMarketCap: number | null; // 元
  floatMarketCap: number | null;
  roe: number | null; // %
  totalShares: number | null;
}

export interface MoneyFlow {
  code: string;
  mainNet: number;       // 主力净流入（元）
  mainPct: number;       // 主力净流入占比 %
  superLargeNet: number;
  superLargePct: number;
  largeNet: number;
  largePct: number;
  mediumNet: number;
  mediumPct: number;
  smallNet: number;
  smallPct: number;
  northNet: number | null;  // 北向资金净流入（元），非沪深港通标的为 null
  northPct: number | null;  // 北向资金净流入占比 %，非沪深港通标的为 null
  northBuy: number | null;  // 北向资金买入金额（元）
  northSell: number | null; // 北向资金卖出金额（元）
  northVol: number | null;  // 北向资金成交股数（股）
  northAmount: number | null; // 北向资金成交金额（元）
  northDate: string | null; // 北向持股数据日期，如 "2024-08-16"
}

/** 一根日 K 线 */
export interface KlineBar {
  date: string;      // "2024-01-15"
  open: number;
  close: number;
  high: number;
  low: number;
  volume: number;    // 手
  amount: number;    // 元
  changePct: number; // %
}

/** 一根资金流日线 */
export interface MFKlineBar {
  date:          string;  // "YYYY-MM-DD"
  mainNet:       number;  // 主力净流入，元（大单+超大单）
  mainPct:       number;  // 主力净流入占比 %
  superLargeNet: number;
  superLargePct: number;
  largeNet:      number;
  mediumNet:     number;
  smallNet:      number;
}

/** 财报期数据（季报/半年报/年报），含同比增速 */
export interface FinReport {
  reportDate:  string;        // "2026-03-31"
  reportType:  string;        // "一季报" | "半年报" | "三季报" | "年报"
  shortLabel:  string;        // "2026Q1" | "2025年报"
  revenue:     number;        // 营业总收入，元
  profit:      number;        // 归母净利润，元
  eps:         number | null; // 基本EPS
  roe:         number | null; // 加权平均ROE %
  revenueYoy:  number | null; // 营收同比 %
  profitYoy:   number | null; // 净利同比 %
}

/** 单条公告摘要 */
export interface Announcement {
  title: string;
  date: string;  // "2024-01-15"
  type: string;  // 公告类型，如 "业绩预告"、"股东增减持"
  url?: string;
}

export interface ApiEnvelope<T> {
  ok: boolean;
  data?: T;
  error?: string;
  ts?: number;
}

// 保留向后兼容别名
export type ApiResult<T> = ApiEnvelope<T>;

export interface AnalysisScores {
  基本面?: number;
  技术面?: number;
  资金面?: number;
  消息面?: number;
}

export interface AnalysisResult {
  conclusion: string;
  scores?: AnalysisScores;
  bullish: string[];
  bearish: string[];
  risks: string[];
  suggestion: string;
  raw?: string; // 模型未输出合规 JSON 时的原文兜底
}