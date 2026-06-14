/**
 * 风险过滤模块
 * 负责识别和排除高风险标的
 * 包括强制排除条件和风险系数计算
 */

import type { Fundamental, Quote } from '@/types';

/** 风险等级 */
export type RiskLevel = 'low' | 'medium' | 'high';

/** 风险项 */
export interface RiskItem {
  code: string;        // 风险代码
  name: string;        // 风险名称
  description: string; // 风险描述
  severity: 'warning' | 'danger'; // 严重程度
  impact: number;      // 风险影响系数（0-1）
}

/** 风险过滤结果 */
export interface RiskFilterResult {
  isExcluded: boolean;    // 是否被排除
  riskLevel: RiskLevel;   // 风险等级
  riskItems: RiskItem[];  // 检测到的风险项列表
  riskAdjustment: number; // 风险调整系数（0-1）
}

/** 风险规则配置 */
const RISK_RULES = [
  {
    code: 'ST',
    name: 'ST警示',
    description: '股票被实施特别处理，存在退市风险',
    severity: 'danger' as const,
    impact: 1.0,
    check: (quote: Quote | null) => 
      quote?.name?.includes('ST') || quote?.name?.includes('*ST')
  },
  {
    code: 'SUSPENDED',
    name: '停牌',
    description: '股票当前处于停牌状态，无法交易',
    severity: 'danger' as const,
    impact: 1.0,
    check: (quote: Quote | null, fundamental: Fundamental | null) => 
      fundamental?.volume === 0 || quote?.volume === 0
  },
  {
    code: 'LOW_LIQUIDITY',
    name: '流动性不足',
    description: '日均成交额低于5000万，可能存在流动性风险',
    severity: 'warning' as const,
    impact: 0.15,
    check: (_quote: Quote | null, fundamental: Fundamental | null) => {
      const amount = fundamental?.amount ?? 0;
      return amount > 0 && amount < 5000 * 10000;
    }
  },
  {
    code: 'SMALL_CAP',
    name: '市值过小',
    description: '流通市值低于30亿，波动性可能较大',
    severity: 'warning' as const,
    impact: 0.10,
    check: (_quote: Quote | null, fundamental: Fundamental | null) => {
      const marketCap = fundamental?.floatMarketCap ?? 0;
      return marketCap > 0 && marketCap < 30 * 10000 * 10000;
    }
  },
  {
    code: 'HIGH_VOLATILITY',
    name: '高波动率',
    description: '近期股价波动剧烈，风险较高',
    severity: 'warning' as const,
    impact: 0.10,
    check: (quote: Quote | null) => {
      if (!quote) return false;
      const range = quote.high - quote.low;
      const volatility = range / quote.prevClose;
      return volatility > 0.15; // 当日振幅超过15%
    }
  },
  {
    code: 'EXTREME_PCT',
    name: '涨跌幅异常',
    description: '当日涨跌幅超过±10%，需警惕',
    severity: 'warning' as const,
    impact: 0.08,
    check: (quote: Quote | null) => {
      return quote ? Math.abs(quote.changePct) > 10 : false;
    }
  },
  {
    code: 'HIGH_PE',
    name: '高PE',
    description: '市盈率过高，估值风险较大',
    severity: 'warning' as const,
    impact: 0.08,
    check: (_quote: Quote | null, fundamental: Fundamental | null) => {
      const pe = fundamental?.peTTM ?? 0;
      return pe > 100;
    }
  },
  {
    code: 'NEGATIVE_ROE',
    name: '负ROE',
    description: '净资产收益率为负，盈利能力不佳',
    severity: 'warning' as const,
    impact: 0.12,
    check: (_quote: Quote | null, fundamental: Fundamental | null) => {
      const roe = fundamental?.roe ?? 0;
      return roe < 0;
    }
  }
];

/**
 * 执行风险过滤
 * @param quote 行情数据
 * @param fundamental 基本面数据
 * @returns 风险过滤结果
 */
export function filterRisk(
  quote: Quote | null,
  fundamental: Fundamental | null
): RiskFilterResult {
  const riskItems: RiskItem[] = [];
  let totalImpact = 0;
  let hasDanger = false;

  for (const rule of RISK_RULES) {
    if (rule.check(quote, fundamental)) {
      riskItems.push({
        code: rule.code,
        name: rule.name,
        description: rule.description,
        severity: rule.severity,
        impact: rule.impact
      });

      if (rule.severity === 'danger') {
        hasDanger = true;
      }

      totalImpact += rule.impact;
    }
  }

  // 确定风险等级
  let riskLevel: RiskLevel;
  if (hasDanger || totalImpact >= 0.5) {
    riskLevel = 'high';
  } else if (totalImpact >= 0.2) {
    riskLevel = 'medium';
  } else {
    riskLevel = 'low';
  }

  // 计算风险调整系数（用于调整最终评分）
  // 单一风险最多影响20%，多个风险最多影响40%
  const riskAdjustment = Math.max(0.6, 1 - Math.min(totalImpact, 0.4));

  return {
    isExcluded: hasDanger,
    riskLevel,
    riskItems,
    riskAdjustment
  };
}

/**
 * 获取风险等级对应的颜色类名
 * @param level 风险等级
 * @returns Tailwind CSS 颜色类名
 */
export function getRiskLevelColor(level: RiskLevel): string {
  const colors: Record<RiskLevel, string> = {
    low: 'text-green-600',
    medium: 'text-yellow-600',
    high: 'text-red-600'
  };
  return colors[level];
}

/**
 * 获取风险等级对应的背景颜色类名
 * @param level 风险等级
 * @returns Tailwind CSS 背景颜色类名
 */
export function getRiskLevelBgColor(level: RiskLevel): string {
  const colors: Record<RiskLevel, string> = {
    low: 'bg-green-50 text-green-700',
    medium: 'bg-yellow-50 text-yellow-700',
    high: 'bg-red-50 text-red-700'
  };
  return colors[level];
}

/**
 * 获取风险等级描述
 * @param level 风险等级
 * @returns 描述文字
 */
export function getRiskLevelDescription(level: RiskLevel): string {
  const descriptions: Record<RiskLevel, string> = {
    low: '低风险',
    medium: '中等风险',
    high: '高风险'
  };
  return descriptions[level];
}