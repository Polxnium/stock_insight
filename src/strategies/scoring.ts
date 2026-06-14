/**
 * 评分模型模块
 * 负责将因子计算结果汇总为综合评分
 * 支持多维度评分和风险调整
 */

import type { FactorValue } from './factors';

/** 维度评分 */
export interface DimensionScore {
  name: string;        // 维度名称
  weight: number;      // 维度权重（百分比）
  score: number;       // 维度得分（0-100）
  factors: FactorValue[]; // 该维度的因子列表
}

/** 综合评分结果 */
export interface ScoringResult {
  totalScore: number;           // 综合得分（0-100）
  fundamentalScore: number;     // 基本面得分（0-100）
  technicalScore: number;       // 技术面得分（0-100）
  moneyScore: number;           // 资金面得分（0-100）
  dimensions: DimensionScore[]; // 各维度详细评分
  grade: ScoreGrade;            // 评级
  gradeDescription: string;     // 评级描述
}

/** 评分等级 */
export type ScoreGrade = 'S' | 'A' | 'B' | 'C' | 'D';

/** 评分等级描述映射 */
const GRADE_DESCRIPTIONS: Record<ScoreGrade, string> = {
  S: '优秀 - 各项指标表现出色，强烈推荐关注',
  A: '良好 - 基本面扎实，技术面健康，值得关注',
  B: '一般 - 存在一定潜力，但需要进一步观察',
  C: '较差 - 多项指标表现不佳，谨慎对待',
  D: '风险 - 存在明显风险，建议规避'
};

/** 维度权重配置 */
export interface DimensionWeights {
  fundamental: number;  // 基本面权重 (百分比)
  technical: number;    // 技术面权重 (百分比)
  money: number;        // 资金面权重 (百分比)
}

/** 默认维度配置 */
const DEFAULT_DIMENSIONS: { name: string; key: keyof DimensionWeights; weight: number }[] = [
  { name: '基本面', key: 'fundamental', weight: 35 },
  { name: '技术面', key: 'technical', weight: 35 },
  { name: '资金面', key: 'money', weight: 30 }
];

/**
 * 计算综合评分
 * @param fundamentalFactors 基本面因子列表
 * @param technicalFactors 技术面因子列表
 * @param moneyFactors 资金面因子列表
 * @param weights 可选的自定义权重配置
 * @returns 综合评分结果
 */
export function calculateScore(
  fundamentalFactors: FactorValue[],
  technicalFactors: FactorValue[],
  moneyFactors: FactorValue[],
  weights?: DimensionWeights
): ScoringResult {
  // 计算各维度得分
  const fundamentalScore = calculateDimensionScore(fundamentalFactors);
  const technicalScore = calculateDimensionScore(technicalFactors);
  const moneyScore = calculateDimensionScore(moneyFactors);

  // 构建维度配置（使用自定义权重或默认值）
  const dimensions = DEFAULT_DIMENSIONS.map(d => ({
    name: d.name,
    weight: weights ? weights[d.key] : d.weight,
  }));

  // 计算综合得分（加权平均）
  const totalScore = (
    fundamentalScore * dimensions[0].weight +
    technicalScore * dimensions[1].weight +
    moneyScore * dimensions[2].weight
  ) / 100;

  // 确定评级
  const grade = determineGrade(totalScore);

  return {
    totalScore: Math.round(totalScore * 10) / 10,
    fundamentalScore: Math.round(fundamentalScore * 10) / 10,
    technicalScore: Math.round(technicalScore * 10) / 10,
    moneyScore: Math.round(moneyScore * 10) / 10,
    dimensions: [
      {
        name: dimensions[0].name,
        weight: dimensions[0].weight,
        score: Math.round(fundamentalScore * 10) / 10,
        factors: fundamentalFactors
      },
      {
        name: dimensions[1].name,
        weight: dimensions[1].weight,
        score: Math.round(technicalScore * 10) / 10,
        factors: technicalFactors
      },
      {
        name: dimensions[2].name,
        weight: dimensions[2].weight,
        score: Math.round(moneyScore * 10) / 10,
        factors: moneyFactors
      }
    ],
    grade,
    gradeDescription: GRADE_DESCRIPTIONS[grade]
  };
}

/**
 * 计算单个维度的得分
 * @param factors 该维度的因子列表
 * @returns 维度得分（0-100）
 */
function calculateDimensionScore(factors: FactorValue[]): number {
  if (factors.length === 0) return 50;

  // 计算有效因子的加权平均分
  let totalWeight = 0;
  let weightedSum = 0;

  for (const factor of factors) {
    // 跳过无效值的因子
    if (factor.value === null || !Number.isFinite(factor.value)) {
      continue;
    }

    totalWeight += factor.weight;
    // normalized: [-1, 1] -> [0, 100]
    weightedSum += (factor.normalized + 1) * 50 * factor.weight;
  }

  if (totalWeight === 0) return 50;

  return weightedSum / totalWeight;
}

/**
 * 根据综合得分确定评级
 * @param score 综合得分（0-100）
 * @returns 评级等级
 */
function determineGrade(score: number): ScoreGrade {
  if (score >= 85) return 'S';
  if (score >= 70) return 'A';
  if (score >= 55) return 'B';
  if (score >= 40) return 'C';
  return 'D';
}

/**
 * 获取评级对应的颜色类名
 * @param grade 评级等级
 * @returns Tailwind CSS 颜色类名
 */
export function getGradeColor(grade: ScoreGrade): string {
  const colors: Record<ScoreGrade, string> = {
    S: 'text-purple-600',
    A: 'text-up',
    B: 'text-yellow-600',
    C: 'text-orange-500',
    D: 'text-down'
  };
  return colors[grade];
}

/**
 * 获取评级对应的背景颜色类名
 * @param grade 评级等级
 * @returns Tailwind CSS 背景颜色类名
 */
export function getGradeBgColor(grade: ScoreGrade): string {
  const colors: Record<ScoreGrade, string> = {
    S: 'bg-purple-100 text-purple-700',
    A: 'bg-green-100 text-green-700',
    B: 'bg-yellow-100 text-yellow-700',
    C: 'bg-orange-100 text-orange-700',
    D: 'bg-red-100 text-red-700'
  };
  return colors[grade];
}

/**
 * 获取评级对应的描述文本
 * @param grade 评级等级
 * @returns 评级描述文本
 */
export function getGradeDescription(grade: ScoreGrade): string {
  return GRADE_DESCRIPTIONS[grade];
}