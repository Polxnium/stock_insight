/**
 * 因子计算模块
 * 提供基本面、技术面、资金面的因子计算逻辑
 * 每个因子都有明确的计算方法和归一化处理
 */

import type { Fundamental, MoneyFlow, FinReport, KlineBar } from '@/types';

/** 因子值接口 */
export interface FactorValue {
  name: string;           // 因子名称
  value: number | null;   // 原始值
  normalized: number;     // 归一化后的值 [-1, 1]
  weight: number;         // 因子权重（百分比）
  isPositive: boolean;    // 是否正向因子
  description: string;    // 因子描述
}

/** 因子计算上下文 */
export interface FactorContext {
  fundamental: Fundamental | null;
  moneyFlow: MoneyFlow | null;
  reports: FinReport[];
  klineData: KlineBar[];
}

/** 基本面因子计算 */
export namespace FundamentalFactors {
  /**
   * ROE(TTM) - 净资产收益率
   * 衡量公司盈利能力的核心指标
   */
  export function calculateROE(context: FactorContext): FactorValue {
    const roe = context.fundamental?.roe ?? context.reports[0]?.roe ?? null;
    return {
      name: 'ROE(TTM)',
      value: roe,
      normalized: normalizeFactor(roe, 0, 30, true),
      weight: 8,
      isPositive: true,
      description: '净资产收益率，反映公司盈利能力'
    };
  }

  /**
   * EPS增长率
   * 衡量每股收益的增长速度
   */
  export function calculateEPSGrowth(context: FactorContext): FactorValue {
    if (context.reports.length < 2) {
      return {
        name: 'EPS增长率',
        value: null,
        normalized: 0,
        weight: 7,
        isPositive: true,
        description: '每股收益同比增长率'
      };
    }
    const currentEPS = context.reports[0]?.eps ?? 0;
    const lastEPS = context.reports[1]?.eps ?? 0;
    const growth = lastEPS !== 0 ? ((currentEPS - lastEPS) / Math.abs(lastEPS)) * 100 : null;
    return {
      name: 'EPS增长率',
      value: growth,
      normalized: normalizeFactor(growth, -50, 100, true),
      weight: 7,
      isPositive: true,
      description: '每股收益同比增长率'
    };
  }

  /**
   * 营收增长率
   * 衡量公司业务扩张速度
   */
  export function calculateRevenueGrowth(context: FactorContext): FactorValue {
    if (context.reports.length < 2) {
      return {
        name: '营收增长率',
        value: null,
        normalized: 0,
        weight: 6,
        isPositive: true,
        description: '营业收入同比增长率'
      };
    }
    const currentRevenue = context.reports[0]?.revenue ?? 0;
    const lastRevenue = context.reports[1]?.revenue ?? 0;
    const growth = lastRevenue !== 0 ? ((currentRevenue - lastRevenue) / Math.abs(lastRevenue)) * 100 : null;
    return {
      name: '营收增长率',
      value: growth,
      normalized: normalizeFactor(growth, -30, 50, true),
      weight: 6,
      isPositive: true,
      description: '营业收入同比增长率'
    };
  }

  /**
   * PE(TTM)分位
   * 市盈率在行业中的相对位置
   */
  export function calculatePEPercentile(context: FactorContext): FactorValue {
    const pe = context.fundamental?.peTTM ?? null;
    // 假设行业PE区间为0-100，计算相对位置
    const percentile = pe !== null && pe > 0 ? Math.min(pe / 100, 1) * 100 : null;
    return {
      name: 'PE分位',
      value: percentile,
      normalized: normalizeFactor(percentile, 0, 100, false),
      weight: 5,
      isPositive: false,
      description: '市盈率在行业中的百分位，越低越优'
    };
  }

  /**
   * PB分位
   * 市净率在行业中的相对位置
   */
  export function calculatePBPercentile(context: FactorContext): FactorValue {
    const pb = context.fundamental?.pb ?? null;
    // 假设行业PB区间为0-10，计算相对位置
    const percentile = pb !== null && pb > 0 ? Math.min(pb / 10, 1) * 100 : null;
    return {
      name: 'PB分位',
      value: percentile,
      normalized: normalizeFactor(percentile, 0, 100, false),
      weight: 5,
      isPositive: false,
      description: '市净率在行业中的百分位，越低越优'
    };
  }

  /**
   * 现金流健康度
   * 经营现金流与净利润的比率
   */
  export function calculateCashFlowHealth(context: FactorContext): FactorValue {
    if (context.reports.length === 0) {
      return {
        name: '现金流健康度',
        value: null,
        normalized: 0,
        weight: 4,
        isPositive: true,
        description: '经营现金流与净利润的比率'
      };
    }
    // 简化处理：用ROE和EPS综合判断财务健康度
    const roe = context.fundamental?.roe ?? context.reports[0]?.roe ?? 0;
    const eps = context.fundamental?.eps ?? context.reports[0]?.eps ?? 0;
    const healthScore = (roe > 0 ? roe / 20 : 0) + (eps > 0 ? eps / 5 : 0);
    return {
      name: '现金流健康度',
      value: Math.min(healthScore, 2),
      normalized: normalizeFactor(healthScore, 0, 2, true),
      weight: 4,
      isPositive: true,
      description: '财务健康度综合评分'
    };
  }

  /** 获取所有基本面因子 */
  export function getAllFactors(context: FactorContext): FactorValue[] {
    return [
      calculateROE(context),
      calculateEPSGrowth(context),
      calculateRevenueGrowth(context),
      calculatePEPercentile(context),
      calculatePBPercentile(context),
      calculateCashFlowHealth(context)
    ];
  }
}

/** 技术面因子计算 */
export namespace TechnicalFactors {
  /**
   * RSI相对强弱指标
   * 衡量超买超卖状态
   */
  export function calculateRSI(context: FactorContext): FactorValue {
    if (context.klineData.length < 14) {
      return {
        name: 'RSI',
        value: null,
        normalized: 0,
        weight: 7,
        isPositive: true,
        description: '相对强弱指标，30-70区间最佳'
      };
    }
    const rsi = calculateRSIValue(context.klineData.slice(-14));
    // RSI在30-70之间为理想状态，归一化处理
    const normalized = rsi >= 30 && rsi <= 70 
      ? 1 - Math.abs(rsi - 50) / 20 
      : rsi < 30 ? rsi / 30 - 1 : 1 - (rsi - 70) / 30;
    return {
      name: 'RSI',
      value: rsi,
      normalized: Math.max(-1, Math.min(1, normalized)),
      weight: 7,
      isPositive: true,
      description: '相对强弱指标，30-70区间最佳'
    };
  }

  /**
   * 均线多头排列
   * 判断趋势方向
   */
  export function calculateMAAlignment(context: FactorContext): FactorValue {
    if (context.klineData.length < 60) {
      return {
        name: '均线多头',
        value: null,
        normalized: 0,
        weight: 6,
        isPositive: true,
        description: '5/10/20/60日均线多头排列'
      };
    }
    const prices = context.klineData.map(k => k.close);
    const ma5 = calculateMA(prices, 5);
    const ma10 = calculateMA(prices, 10);
    const ma20 = calculateMA(prices, 20);
    const ma60 = calculateMA(prices, 60);
    
    const isBullish = ma5 > ma10 && ma10 > ma20 && ma20 > ma60;
    const strength = isBullish ? (ma5 - ma60) / ma60 : -Math.abs(ma60 - ma5) / ma60;
    
    return {
      name: '均线多头',
      value: isBullish ? 1 : 0,
      normalized: Math.max(-1, Math.min(1, strength * 10)),
      weight: 6,
      isPositive: true,
      description: '均线多头排列强度'
    };
  }

  /**
   * MACD信号
   * 判断趋势转折
   */
  export function calculateMACD(context: FactorContext): FactorValue {
    if (context.klineData.length < 26) {
      return {
        name: 'MACD',
        value: null,
        normalized: 0,
        weight: 6,
        isPositive: true,
        description: 'MACD指标信号'
      };
    }
    const prices = context.klineData.map(k => k.close);
    const { macd, signal } = calculateMACDValues(prices);
    const histogram = macd - signal;
    const normalized = Math.max(-1, Math.min(1, histogram / (signal * 0.1 || 1)));
    return {
      name: 'MACD',
      value: histogram,
      normalized: normalized,
      weight: 6,
      isPositive: true,
      description: 'MACD柱状图，正值表示多头信号'
    };
  }

  /**
   * 量价配合度
   * 上涨时成交量是否放大
   */
  export function calculateVolumePrice(context: FactorContext): FactorValue {
    if (context.klineData.length < 20) {
      return {
        name: '量价配合',
        value: null,
        normalized: 0,
        weight: 5,
        isPositive: true,
        description: '上涨时成交量配合度'
      };
    }
    const recent = context.klineData.slice(-20);
    const upDays = recent.filter(k => k.changePct > 0);
    const avgVolumeUp = upDays.length > 0 
      ? upDays.reduce((sum, k) => sum + k.amount, 0) / upDays.length 
      : 0;
    const avgVolumeAll = recent.reduce((sum, k) => sum + k.amount, 0) / recent.length;
    const ratio = avgVolumeAll > 0 ? avgVolumeUp / avgVolumeAll : 0;
    return {
      name: '量价配合',
      value: ratio,
      normalized: normalizeFactor(ratio, 0.5, 2, true),
      weight: 5,
      isPositive: true,
      description: '上涨日成交量与日均量之比'
    };
  }

  /**
   * 波动率
   * 衡量股价波动程度
   */
  export function calculateVolatility(context: FactorContext): FactorValue {
    if (context.klineData.length < 20) {
      return {
        name: '波动率',
        value: null,
        normalized: 0,
        weight: 5,
        isPositive: false,
        description: '股价波动率，越低越稳定'
      };
    }
    const recent = context.klineData.slice(-20);
    const returns = recent.map(k => k.changePct / 100);
    const mean = returns.reduce((sum, r) => sum + r, 0) / returns.length;
    const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / returns.length;
    const stdDev = Math.sqrt(variance);
    return {
      name: '波动率',
      value: stdDev * 100,
      normalized: normalizeFactor(stdDev * 100, 0, 10, false),
      weight: 5,
      isPositive: false,
      description: '20日收益率标准差，越低越稳定'
    };
  }

  /**
   * 趋势强度(ADX)
   * 衡量趋势的强弱程度
   */
  export function calculateADX(context: FactorContext): FactorValue {
    if (context.klineData.length < 14) {
      return {
        name: '趋势强度',
        value: null,
        normalized: 0,
        weight: 6,
        isPositive: true,
        description: 'ADX趋势强度指标'
      };
    }
    const adx = calculateADXValue(context.klineData.slice(-14));
    return {
      name: '趋势强度',
      value: adx,
      normalized: normalizeFactor(adx, 0, 50, true),
      weight: 6,
      isPositive: true,
      description: 'ADX指标，大于25表示趋势明显'
    };
  }

  /**
   * 5日动量
   * 短期价格动量
   */
  export function calculateMomentum5(context: FactorContext): FactorValue {
    if (context.klineData.length < 6) {
      return {
        name: '5日动量',
        value: null,
        normalized: 0,
        weight: 5,
        isPositive: true,
        description: '5日价格动量'
      };
    }
    const closes = context.klineData.map(k => k.close);
    const current = closes[closes.length - 1];
    const prev = closes[closes.length - 6];
    const momentum = ((current - prev) / prev) * 100;
    return {
      name: '5日动量',
      value: momentum,
      normalized: normalizeFactor(momentum, -10, 10, true),
      weight: 5,
      isPositive: true,
      description: '5日价格动量，正值表示上涨'
    };
  }

  /**
   * 10日动量
   * 中期价格动量
   */
  export function calculateMomentum10(context: FactorContext): FactorValue {
    if (context.klineData.length < 11) {
      return {
        name: '10日动量',
        value: null,
        normalized: 0,
        weight: 5,
        isPositive: true,
        description: '10日价格动量'
      };
    }
    const closes = context.klineData.map(k => k.close);
    const current = closes[closes.length - 1];
    const prev = closes[closes.length - 11];
    const momentum = ((current - prev) / prev) * 100;
    return {
      name: '10日动量',
      value: momentum,
      normalized: normalizeFactor(momentum, -15, 15, true),
      weight: 5,
      isPositive: true,
      description: '10日价格动量，正值表示上涨'
    };
  }

  /**
   * 20日动量
   * 中长期价格动量
   */
  export function calculateMomentum20(context: FactorContext): FactorValue {
    if (context.klineData.length < 21) {
      return {
        name: '20日动量',
        value: null,
        normalized: 0,
        weight: 4,
        isPositive: true,
        description: '20日价格动量'
      };
    }
    const closes = context.klineData.map(k => k.close);
    const current = closes[closes.length - 1];
    const prev = closes[closes.length - 21];
    const momentum = ((current - prev) / prev) * 100;
    return {
      name: '20日动量',
      value: momentum,
      normalized: normalizeFactor(momentum, -20, 20, true),
      weight: 4,
      isPositive: true,
      description: '20日价格动量，正值表示上涨'
    };
  }

  /**
   * 短期反转
   * 过去5日收益率取反，用于捕捉超跌反弹机会
   */
  export function calculateShortTermReversal(context: FactorContext): FactorValue {
    if (context.klineData.length < 6) {
      return {
        name: '短期反转',
        value: null,
        normalized: 0,
        weight: 4,
        isPositive: false,
        description: '5日收益率取反，捕捉超跌反弹'
      };
    }
    const closes = context.klineData.map(k => k.close);
    const current = closes[closes.length - 1];
    const prev = closes[closes.length - 6];
    const returnPct = ((current - prev) / prev) * 100;
    // 取反：跌幅越大，反转预期越强
    const reversal = -returnPct;
    return {
      name: '短期反转',
      value: reversal,
      normalized: normalizeFactor(reversal, -10, 10, true),
      weight: 4,
      isPositive: false,
      description: '5日收益率取反，负收益有反弹预期'
    };
  }

  /**
   * 布林带位置
   * 当前价格在布林带中的位置 (0-1)
   * 20日均线 ± 2倍标准差
   */
  export function calculateBollingerPosition(context: FactorContext): FactorValue {
    if (context.klineData.length < 20) {
      return {
        name: '布林带位置',
        value: null,
        normalized: 0,
        weight: 5,
        isPositive: true,
        description: '布林带位置，0.5为中轨'
      };
    }
    const closes = context.klineData.slice(-20).map(k => k.close);
    const currentPrice = context.klineData[context.klineData.length - 1].close;
    
    // 计算20日均线和标准差
    const mean = closes.reduce((sum, p) => sum + p, 0) / closes.length;
    const variance = closes.reduce((sum, p) => sum + Math.pow(p - mean, 2), 0) / closes.length;
    const stdDev = Math.sqrt(variance);
    
    const upperBand = mean + 2 * stdDev;
    const lowerBand = mean - 2 * stdDev;
    
    // 布林带位置: 0=下轨, 0.5=中轨, 1=上轨
    const position = (upperBand - lowerBand) > 0 
      ? (currentPrice - lowerBand) / (upperBand - lowerBand)
      : 0.5;
    
    // 归一化: 0.5附近最佳 (0.3-0.7)，过高或过低都不好
    // 使用 0.5 为中心，距离越近得分越高
    const deviation = Math.abs(position - 0.5);
    const normalized = 1 - Math.min(1, deviation * 2);
    
    return {
      name: '布林带位置',
      value: position,
      normalized: normalized,
      weight: 5,
      isPositive: true,
      description: '布林带位置，0.3-0.7区间最佳'
    };
  }

  /**
   * KDJ-K值
   * 基于9日RSV平滑计算的K值
   * K>80超买, K<20超卖
   */
  export function calculateKDJ(context: FactorContext): FactorValue {
    if (context.klineData.length < 9) {
      return {
        name: 'KDJ-K',
        value: null,
        normalized: 0,
        weight: 4,
        isPositive: true,
        description: 'KDJ指标K值，20-80区间最佳'
      };
    }
    const klines = context.klineData.slice(-9);
    
    // 计算9日最高价和最低价
    const highs = klines.map(k => k.high);
    const lows = klines.map(k => k.low);
    const highestHigh = Math.max(...highs);
    const lowestLow = Math.min(...lows);
    
    const currentPrice = klines[klines.length - 1].close;
    
    // RSV = (当前价 - 最低价) / (最高价 - 最低价) * 100
    const rsv = (highestHigh - lowestLow) > 0
      ? ((currentPrice - lowestLow) / (highestHigh - lowestLow)) * 100
      : 50;
    
    // K值平滑: K = 2/3 * 前K + 1/3 * RSV
    // 初始K值设为50
    let k = 50;
    for (let i = 0; i < klines.length; i++) {
      const h = Math.max(...klines.slice(0, i + 1).map(x => x.high));
      const l = Math.min(...klines.slice(0, i + 1).map(x => x.low));
      const r = (h - l) > 0 ? ((klines[i].close - l) / (h - l)) * 100 : 50;
      k = (2 / 3) * k + (1 / 3) * r;
    }
    
    // 归一化: 50附近最佳，20以下和80以上都不好
    const deviation = Math.abs(k - 50) / 50;
    const normalized = 1 - deviation;
    
    return {
      name: 'KDJ-K',
      value: k,
      normalized: normalized,
      weight: 4,
      isPositive: true,
      description: 'KDJ指标K值，20-80区间最佳'
    };
  }

  /** 获取所有技术面因子 */
  export function getAllFactors(context: FactorContext): FactorValue[] {
    return [
      calculateRSI(context),
      calculateMAAlignment(context),
      calculateMACD(context),
      calculateVolumePrice(context),
      calculateVolatility(context),
      calculateADX(context),
      calculateMomentum5(context),
      calculateMomentum10(context),
      calculateMomentum20(context),
      calculateShortTermReversal(context),
      calculateBollingerPosition(context),
      calculateKDJ(context)
    ];
  }
}

/** 资金面因子计算 */
export namespace MoneyFlowFactors {
  /**
   * 主力资金净流入
   * 机构资金动向
   */
  export function calculateMainFlow(context: FactorContext): FactorValue {
    const mainNet = context.moneyFlow?.mainNet ?? null;
    // 转换为相对值（占成交额比例）
    const amount = context.fundamental?.amount ?? 1;
    const ratio = mainNet !== null ? mainNet / amount : null;
    return {
      name: '主力净流入',
      value: ratio ? ratio * 100 : null,
      normalized: normalizeFactor(ratio ? ratio * 100 : null, -5, 5, true),
      weight: 8,
      isPositive: true,
      description: '主力资金净流入占成交额比例'
    };
  }

  /**
   * 北向持股
   * 外资持仓占成交额比例，反映外资对该股的关注度
   */
  export function calculateNorthFlow(context: FactorContext): FactorValue {
    const northNet = context.moneyFlow?.northNet ?? null;
    const amount = context.fundamental?.amount ?? 1;
    const ratio = northNet !== null ? northNet / amount : null;
    return {
      name: '北向持股',
      value: ratio ? ratio * 100 : null,
      normalized: normalizeFactor(ratio ? ratio * 100 : null, -3, 3, true),
      weight: 7,
      isPositive: true,
      description: '北向资金持仓占成交额比例，持仓越高说明外资越看好'
    };
  }

  /**
   * 换手率
   * 股票活跃度
   */
  export function calculateTurnover(context: FactorContext): FactorValue {
    const turnover = context.fundamental?.turnover ?? null;
    // 适中的换手率最佳（2%-8%）
    const normalized = turnover !== null 
      ? turnover >= 2 && turnover <= 8 
        ? 1 - Math.abs(turnover - 5) / 3 
        : turnover < 2 ? turnover / 2 - 1 : 1 - (turnover - 8) / 10
      : 0;
    return {
      name: '换手率',
      value: turnover,
      normalized: Math.max(-1, Math.min(1, normalized)),
      weight: 5,
      isPositive: true,
      description: '换手率，2%-8%区间最佳'
    };
  }

  /**
   * 量比
   * 当前成交量相对水平
   */
  export function calculateVolumeRatio(context: FactorContext): FactorValue {
    const volumeRatio = context.fundamental?.volumeRatio ?? null;
    return {
      name: '量比',
      value: volumeRatio,
      normalized: normalizeFactor(volumeRatio, 0.5, 3, true),
      weight: 5,
      isPositive: true,
      description: '当前成交量与5日均量之比'
    };
  }

  /**
   * 大单净流率
   * 大单资金动向
   */
  export function calculateLargeOrderFlow(context: FactorContext): FactorValue {
    const largeNet = context.moneyFlow?.largeNet ?? 0;
    const superLargeNet = context.moneyFlow?.superLargeNet ?? 0;
    const amount = context.fundamental?.amount ?? 1;
    const ratio = (largeNet + superLargeNet) / amount;
    return {
      name: '大单净流入',
      value: ratio * 100,
      normalized: normalizeFactor(ratio * 100, -5, 5, true),
      weight: 5,
      isPositive: true,
      description: '大单资金净流入占成交额比例'
    };
  }

  /** 获取所有资金面因子 */
  export function getAllFactors(context: FactorContext): FactorValue[] {
    return [
      calculateMainFlow(context),
      calculateNorthFlow(context),
      calculateTurnover(context),
      calculateVolumeRatio(context),
      calculateLargeOrderFlow(context)
    ];
  }
}

/**
 * 因子归一化函数
 * 将原始因子值映射到 [-1, 1] 区间
 */
function normalizeFactor(value: number | null, min: number, max: number, isPositive: boolean): number {
  if (value === null || !Number.isFinite(value)) return 0;
  
  const normalized = (value - min) / (max - min);
  const clamped = Math.max(0, Math.min(1, normalized));
  
  if (isPositive) {
    return clamped * 2 - 1; // [0, 1] -> [-1, 1]
  } else {
    return 1 - clamped * 2; // 反向，值越小得分越高
  }
}

/**
 * RSI指标计算
 */
function calculateRSIValue(data: KlineBar[]): number {
  let gains = 0;
  let losses = 0;
  
  for (let i = 1; i < data.length; i++) {
    const change = data[i].close - data[i - 1].close;
    if (change > 0) gains += change;
    else losses += Math.abs(change);
  }
  
  const avgGain = gains / (data.length - 1);
  const avgLoss = losses / (data.length - 1);
  
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

/**
 * 简单移动平均计算
 */
function calculateMA(prices: number[], period: number): number {
  if (prices.length < period) return prices[prices.length - 1] ?? 0;
  const sum = prices.slice(-period).reduce((acc, p) => acc + p, 0);
  return sum / period;
}

/**
 * MACD指标计算
 */
function calculateMACDValues(prices: number[]): { macd: number; signal: number } {
  const ema12 = calculateEMA(prices, 12);
  const ema26 = calculateEMA(prices, 26);
  const macd = ema12 - ema26;
  const signal = calculateEMA([...prices.slice(0, -1), macd], 9);
  return { macd, signal };
}

/**
 * 指数移动平均计算
 */
function calculateEMA(prices: number[], period: number): number {
  if (prices.length === 0) return 0;
  const k = 2 / (period + 1);
  let ema = prices[0];
  for (let i = 1; i < prices.length; i++) {
    ema = prices[i] * k + ema * (1 - k);
  }
  return ema;
}

/**
 * ADX指标计算（简化版）
 */
function calculateADXValue(data: KlineBar[]): number {
  if (data.length < 14) return 0;
  
  let sumTR = 0;
  let sumDMPlus = 0;
  let sumDMMinus = 0;
  
  for (let i = 1; i < data.length; i++) {
    const tr = Math.max(
      data[i].high - data[i].low,
      Math.abs(data[i].high - data[i - 1].close),
      Math.abs(data[i].low - data[i - 1].close)
    );
    sumTR += tr;
    
    const upMove = data[i].high - data[i - 1].high;
    const downMove = data[i - 1].low - data[i].low;
    sumDMPlus += upMove > downMove && upMove > 0 ? upMove : 0;
    sumDMMinus += downMove > upMove && downMove > 0 ? downMove : 0;
  }
  
  const diPlus = (sumDMPlus / sumTR) * 100;
  const diMinus = (sumDMMinus / sumTR) * 100;
  const dx = Math.abs(diPlus - diMinus) / (diPlus + diMinus) * 100;
  
  return dx;
}