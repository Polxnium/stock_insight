/**
 * 量化选股核心模块
 * 整合因子计算、评分模型和风险过滤
 * 提供完整的选股功能
 */

import type { Fundamental, MoneyFlow, FinReport, KlineBar, Quote } from '@/types';
import { 
  FundamentalFactors, 
  TechnicalFactors, 
  MoneyFlowFactors,
  type FactorContext,
  type FactorValue 
} from './factors';
import { calculateScore, type ScoringResult, type DimensionWeights } from './scoring';
import { filterRisk, type RiskFilterResult } from './riskFilter';

/** 数据质量标记 */
export interface DataQuality {
  hasFundamental: boolean;   // 是否有基本面数据
  hasMoneyFlow: boolean;     // 是否有资金流数据
  hasKline: boolean;         // 是否有K线数据
  hasReports: boolean;       // 是否有财报数据
  missingSources: string[];  // 缺失的数据源列表
}

/** 选股结果项 */
export interface SelectorStock {
  code: string;                    // 股票代码
  name: string;                    // 股票名称
  price: number;                   // 当前价格
  changePct: number;               // 涨跌幅
  score: ScoringResult;            // 评分结果
  risk: RiskFilterResult;          // 风险评估结果
  adjustedScore: number;           // 风险调整后的得分
  rank: number;                    // 排名
  dataQuality: DataQuality;        // 数据质量标记
}

/** 选股结果 */
export interface SelectorResult {
  stocks: SelectorStock[];         // 选股结果列表
  totalCount: number;              // 候选股票总数
  filteredCount: number;           // 过滤后数量
  topCount: number;                // 输出数量
  timestamp: number;               // 计算时间戳
}

/** 选股参数 */
export interface SelectorParams {
  topN: number;                    // 返回前N只股票
  minScore: number;                // 最低评分阈值
  maxRiskLevel: 'low' | 'medium' | 'high'; // 最大可接受风险等级
}

/** 默认选股参数 */
export const DEFAULT_PARAMS: SelectorParams = {
  topN: 10,
  minScore: 50,
  maxRiskLevel: 'high'
};

/**
 * 对单只股票进行量化分析
 * @param code 股票代码
 * @param name 股票名称
 * @param quote 行情数据
 * @param fundamental 基本面数据
 * @param moneyFlow 资金流数据
 * @param reports 财报数据
 * @param klineData K线数据
 * @param weights 可选的自定义权重配置
 * @returns 分析结果
 */
export function analyzeStock(
  code: string,
  name: string,
  quote: Quote | null,
  fundamental: Fundamental | null,
  moneyFlow: MoneyFlow | null,
  reports: FinReport[],
  klineData: KlineBar[],
  weights?: DimensionWeights
): SelectorStock {
  // 构建因子计算上下文
  const context: FactorContext = {
    fundamental,
    moneyFlow,
    reports,
    klineData
  };

  // 数据质量检查
  const missingSources: string[] = [];
  if (!fundamental) missingSources.push('基本面');
  if (!moneyFlow) missingSources.push('资金流向');
  if (!klineData || klineData.length === 0) missingSources.push('K线');
  if (!reports || reports.length === 0) missingSources.push('财报');

  const dataQuality: DataQuality = {
    hasFundamental: !!fundamental,
    hasMoneyFlow: !!moneyFlow,
    hasKline: !!(klineData && klineData.length > 0),
    hasReports: !!(reports && reports.length > 0),
    missingSources,
  };

  // 计算各维度因子
  const fundamentalFactors = FundamentalFactors.getAllFactors(context);
  const technicalFactors = TechnicalFactors.getAllFactors(context);
  const moneyFactors = MoneyFlowFactors.getAllFactors(context);

  // 计算评分（传入自定义权重）
  const score = calculateScore(fundamentalFactors, technicalFactors, moneyFactors, weights);

  // 风险评估
  const risk = filterRisk(quote, fundamental);

  // 计算风险调整后的得分
  const adjustedScore = score.totalScore * risk.riskAdjustment;

  return {
    code,
    name,
    price: quote?.price ?? fundamental?.price ?? 0,
    changePct: quote?.changePct ?? fundamental?.changePct ?? 0,
    score,
    risk,
    adjustedScore: Math.round(adjustedScore * 10) / 10,
    rank: 0,
    dataQuality,
  };
}

/**
 * 批量分析股票并排序
 * @param stocks 待分析股票列表
 * @param params 选股参数
 * @param weights 可选的自定义权重配置
 * @returns 选股结果
 */
export function selectStocks(
  stocks: Array<{
    code: string;
    name: string;
    quote?: Quote | null;
    fundamental?: Fundamental | null;
    moneyFlow?: MoneyFlow | null;
    reports?: FinReport[];
    klineData?: KlineBar[];
  }>,
  params: SelectorParams = DEFAULT_PARAMS,
  weights?: DimensionWeights
): SelectorResult {
  const analyzedStocks: SelectorStock[] = [];

  // 分析每只股票
  for (const stock of stocks) {
    const result = analyzeStock(
      stock.code,
      stock.name,
      stock.quote ?? null,
      stock.fundamental ?? null,
      stock.moneyFlow ?? null,
      stock.reports ?? [],
      stock.klineData ?? [],
      weights
    );

    // 应用过滤条件
    if (result.adjustedScore < params.minScore) {
      continue;
    }

    // 风险等级过滤
    const riskLevels: Array<'low' | 'medium' | 'high'> = ['low', 'medium', 'high'];
    const currentLevelIndex = riskLevels.indexOf(result.risk.riskLevel);
    const maxLevelIndex = riskLevels.indexOf(params.maxRiskLevel);
    if (currentLevelIndex > maxLevelIndex) {
      continue;
    }

    analyzedStocks.push(result);
  }

  // 按调整后得分排序
  analyzedStocks.sort((a, b) => b.adjustedScore - a.adjustedScore);

  // 设置排名
  analyzedStocks.forEach((stock, index) => {
    stock.rank = index + 1;
  });

  // 取前N只
  const topStocks = analyzedStocks.slice(0, params.topN);

  return {
    stocks: topStocks,
    totalCount: stocks.length,
    filteredCount: analyzedStocks.length,
    topCount: topStocks.length,
    timestamp: Date.now()
  };
}

/**
 * 获取因子详情列表（用于展示）
 * @param stock 选股结果项
 * @returns 所有因子详情
 */
export function getFactorDetails(stock: SelectorStock): FactorValue[] {
  const allFactors: FactorValue[] = [];
  
  for (const dimension of stock.score.dimensions) {
    allFactors.push(...dimension.factors);
  }
  
  return allFactors;
}

/**
 * 获取评分摘要
 * @param stock 选股结果项
 * @returns 评分摘要文本
 */
export function getScoreSummary(stock: SelectorStock): string {
  const { totalScore, grade, fundamentalScore, technicalScore, moneyScore } = stock.score;
  const { riskLevel } = stock.risk;
  
  return `${stock.name}(${stock.code}) 综合评分: ${totalScore.toFixed(1)}分 (${grade}级), 风险等级: ${riskLevel === 'low' ? '低' : riskLevel === 'medium' ? '中' : '高'}\n` +
    `基本面: ${fundamentalScore.toFixed(1)} | 技术面: ${technicalScore.toFixed(1)} | 资金面: ${moneyScore.toFixed(1)}`;
}