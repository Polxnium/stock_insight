/**
 * indicators.ts — 技术指标计算模块
 *
 * 设计原则：
 *   - 所有函数均为纯函数（仅输入→输出，无副作用），便于单独测试
 *   - 计算函数只关心数字，与 UI / prompt 完全解耦
 *   - summarizeTechnicals() 是"胶水层"：把原始数据翻译成人类可读文字，供 LLM prompt 消费
 *
 * 输入约定：K 线数组按日期从旧到新（index 0 = 最早，index n-1 = 最新）
 */

import type { KlineBar } from '@/types';

// ============================================================
// 基础指标计算（pure functions）
// ============================================================

/**
 * 简单移动平均线（SMA）
 * 数据不足时对应位置返回 null。
 */
export function calcMA(closes: number[], period: number): (number | null)[] {
  return closes.map((_, i) => {
    if (i < period - 1) return null;
    const slice = closes.slice(i - period + 1, i + 1);
    return slice.reduce((sum, v) => sum + v, 0) / period;
  });
}

/**
 * 指数移动平均线（EMA）
 * 使用标准平滑系数 k = 2 / (period + 1)，首项用第一个收盘价初始化。
 */
export function calcEMA(closes: number[], period: number): number[] {
  if (closes.length === 0) return [];
  const k = 2 / (period + 1);
  const result: number[] = [closes[0]];
  for (let i = 1; i < closes.length; i++) {
    result.push(closes[i] * k + result[i - 1] * (1 - k));
  }
  return result;
}

/** 单个 MACD 数据点 */
export interface MacdPoint {
  dif:  number; // EMA(fast) - EMA(slow)
  dea:  number; // DIF 的 signal 周期 EMA（即信号线）
  hist: number; // 柱状值 = 2 * (DIF - DEA)，即常见的红绿柱
}

/**
 * MACD 指标（默认参数：12,26,9）
 * 返回与输入等长的数组，前 slow-1 个点的 dif/dea 精度较低（EMA 初期偏差），属正常现象。
 */
export function calcMACD(
  closes: number[],
  fast   = 12,
  slow   = 26,
  signal = 9,
): MacdPoint[] {
  const emaFast = calcEMA(closes, fast);
  const emaSlow = calcEMA(closes, slow);
  const difs    = emaFast.map((v, i) => v - emaSlow[i]);
  const deas    = calcEMA(difs, signal);
  return difs.map((dif, i) => ({
    dif,
    dea:  deas[i],
    hist: 2 * (dif - deas[i]),
  }));
}

/**
 * RSI（相对强弱指数），使用 Wilder 平滑法（与主流软件一致）。
 * 前 period 个点返回 null（数据不足）。
 */
export function calcRSI(closes: number[], period = 14): (number | null)[] {
  if (closes.length <= period) return Array(closes.length).fill(null);

  const result: (number | null)[] = Array(period).fill(null);

  // 首段：用简单平均初始化
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) avgGain += diff;
    else avgLoss -= diff;
  }
  avgGain /= period;
  avgLoss /= period;
  result.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));

  // 后续：Wilder 平滑
  for (let i = period + 1; i < closes.length; i++) {
    const diff  = closes[i] - closes[i - 1];
    const gain  = Math.max(diff, 0);
    const loss  = Math.max(-diff, 0);
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    result.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));
  }
  return result;
}

// ============================================================
// 文字描述生成（供 prompt 消费）
// 这一层只关心"怎么把数字翻译成 LLM 能理解的自然语言"
// ============================================================

const fmt = (n: number | null | undefined, d = 2): string =>
  n == null || !Number.isFinite(n) ? '—' : n.toFixed(d);

/**
 * 将 K 线数组转换为结构化技术分析文字描述。
 * 输出字符串直接用于 AI 分析 prompt 的【技术面】部分。
 *
 * @param bars - 从旧到新排列的日 K 线数组
 * @returns 多行文字描述，包含均线/MACD/RSI/价格位置四个维度
 */
export function summarizeTechnicals(bars: KlineBar[]): string {
  if (bars.length < 10) return '  数据不足（K线根数 < 10，无法计算指标）';

  const closes = bars.map((b) => b.close);
  const highs   = bars.map((b) => b.high);
  const lows    = bars.map((b) => b.low);
  const last    = closes.length - 1;
  const current = closes[last];

  // --- 均线 ---
  const ma5s  = calcMA(closes, 5);
  const ma20s = calcMA(closes, 20);
  const ma60s = calcMA(closes, 60);
  const ma5   = ma5s[last];
  const ma20  = ma20s[last];
  const ma60  = ma60s[last];

  // --- MACD ---
  const macds    = calcMACD(closes);
  const curMacd  = macds[last];
  const prevMacd = macds[last - 1] ?? null;

  // --- RSI(14) ---
  const rsiVals = calcRSI(closes, 14);
  const rsi     = rsiVals[last];

  // --- 近期价格区间 ---
  const windowSize  = Math.min(60, bars.length);
  const recentHighs = highs.slice(-windowSize);
  const recentLows  = lows.slice(-windowSize);
  const rangeHigh   = Math.max(...recentHighs);
  const rangeLow    = Math.min(...recentLows);
  const rangePct    =
    rangeHigh !== rangeLow
      ? ((current - rangeLow) / (rangeHigh - rangeLow)) * 100
      : 50;

  return [
    `  均线趋势：${describeMATrend(current, ma5, ma20, ma60)}`,
    `    MA5=${fmt(ma5)}  MA20=${fmt(ma20)}  MA60=${fmt(ma60)}  当前价=${fmt(current)}`,
    `  MACD(12,26,9)：DIF=${fmt(curMacd.dif, 3)}  DEA=${fmt(curMacd.dea, 3)}  柱=${fmt(curMacd.hist, 3)}${describeMacdSignal(curMacd, prevMacd)}`,
    `  RSI(14)：${fmt(rsi, 1)}（${describeRSILevel(rsi)}）`,
    `  近${windowSize}日价格区间：高 ${fmt(rangeHigh)}，低 ${fmt(rangeLow)}，` +
      `当前处于区间 ${fmt(rangePct, 0)}% 位置`,
  ].join('\n');
}

// ============================================================
// 内部辅助：把指标值翻译成简短文字判断
// ============================================================

/** 均线多空排列判断 */
function describeMATrend(
  price: number,
  ma5:   number | null,
  ma20:  number | null,
  ma60:  number | null,
): string {
  if (ma5 == null || ma20 == null) return '均线数据不足';

  const aboveMa5  = price > ma5;
  const aboveMa20 = price > ma20;
  const aboveMa60 = ma60 != null ? price > ma60 : null;
  const ma5AboveMa20 = ma5 > ma20;

  // 完整多头/空头排列
  if (aboveMa5 && aboveMa20 && aboveMa60 !== false && ma5AboveMa20) {
    return '多头排列 ↑（MA5>MA20>MA60，价格在所有均线上方）';
  }
  if (!aboveMa5 && !aboveMa20 && aboveMa60 === false && !ma5AboveMa20) {
    return '空头排列 ↓（MA5<MA20<MA60，价格在所有均线下方）';
  }
  // 常见过渡形态
  if (aboveMa5 && !aboveMa20)  return 'MA5 短期反弹，MA20 仍形成压力，偏弱整理';
  if (!aboveMa5 && aboveMa20)  return '价格跌破 MA5，仍在 MA20 支撑上方，注意回撤深度';
  if (aboveMa20 && aboveMa60 === false) return 'MA20 上方但 MA60 形成压力，处于反弹区间';
  return '均线交织，趋势不明确，区间震荡可能性较高';
}

/** MACD 金叉/死叉/动能信号 */
function describeMacdSignal(cur: MacdPoint, prev: MacdPoint | null): string {
  if (!prev) return '';
  const goldCross = prev.dif <  prev.dea && cur.dif >= cur.dea;
  const deadCross = prev.dif >  prev.dea && cur.dif <= cur.dea;
  const histPos   = cur.hist > 0;
  const histGrow  = cur.hist > prev.hist;

  if (goldCross)                return '，DIF 上穿 DEA 金叉 ⬆（短期看多信号）';
  if (deadCross)                return '，DIF 下穿 DEA 死叉 ⬇（短期看空信号）';
  if (histPos && histGrow)      return '，红柱扩张（多头动能增强）';
  if (histPos && !histGrow)     return '，红柱收缩（多头动能减弱，注意高位风险）';
  if (!histPos && !histGrow)    return '，绿柱扩张（空头动能增强）';
  return '，绿柱收缩（空头动能减弱，关注底部信号）';
}

/** RSI 超买/超卖/中性区间描述 */
function describeRSILevel(rsi: number | null): string {
  if (rsi == null) return '数据不足';
  if (rsi >= 80)   return '强烈超买，回调风险较高';
  if (rsi >= 70)   return '超买区域，谨慎追高';
  if (rsi >= 60)   return '偏强，趋势仍在';
  if (rsi >= 40)   return '中性区间';
  if (rsi >= 30)   return '偏弱，关注支撑';
  if (rsi >= 20)   return '超卖区域，关注反弹机会';
  return '严重超卖，但可能持续弱势';
}
