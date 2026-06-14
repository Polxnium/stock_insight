import { useState } from 'react';
import { Target, Settings, Check, X } from 'lucide-react';
import { cn } from '@/lib/format';

export interface StrategyConfig {
  name: string;
  description: string;
  icon: string;
  weights: {
    fundamental: number;
    technical: number;
    money: number;
  };
  scenario: string;
}

export const STRATEGIES: StrategyConfig[] = [
  {
    name: '短线激进',
    description: '重技术面和资金面，适合短期投机',
    icon: 'Zap',
    weights: { fundamental: 20, technical: 40, money: 40 },
    scenario: '短期投机、追热点'
  },
  {
    name: '短线稳健',
    description: '均衡配置，适合波段操作',
    icon: 'Shield',
    weights: { fundamental: 35, technical: 35, money: 30 },
    scenario: '短线波段、趋势跟踪'
  },
  {
    name: '波段操作',
    description: '侧重技术面，把握中期趋势',
    icon: 'TrendingUp',
    weights: { fundamental: 25, technical: 50, money: 25 },
    scenario: '中期趋势、均线交易'
  },
  {
    name: '价值投资',
    description: '重基本面，长期持有',
    icon: 'Landmark',
    weights: { fundamental: 50, technical: 25, money: 25 },
    scenario: '长期持有、基本面分析'
  }
];

interface StrategySelectorProps {
  selectedStrategy: StrategyConfig;
  onSelect: (strategy: StrategyConfig) => void;
  customWeights: { fundamental: number; technical: number; money: number };
  onCustomWeightsChange: (weights: { fundamental: number; technical: number; money: number }) => void;
}

export function StrategySelector({
  selectedStrategy,
  onSelect,
  customWeights,
  onCustomWeightsChange
}: StrategySelectorProps) {
  const [showCustom, setShowCustom] = useState(false);
  const [tempWeights, setTempWeights] = useState(customWeights);

  const handleWeightChange = (key: 'fundamental' | 'technical' | 'money', value: number) => {
    const newWeights = { ...tempWeights, [key]: value };
    const total = newWeights.fundamental + newWeights.technical + newWeights.money;
    
    if (total <= 100) {
      setTempWeights(newWeights);
    }
  };

  const handleApplyCustom = () => {
    const total = tempWeights.fundamental + tempWeights.technical + tempWeights.money;
    if (total === 100) {
      onCustomWeightsChange(tempWeights);
      setShowCustom(false);
    }
  };

  return (
    <div className="rounded-lg border border-ink-200 bg-white p-4">
      <div className="flex items-center gap-2 mb-4">
        <Target size={14} className="text-ink-400" />
        <span className="text-sm font-semibold text-ink-900">选股策略</span>
      </div>

      <div className="space-y-2">
        {STRATEGIES.map((strategy) => (
          <button
            key={strategy.name}
            onClick={() => onSelect(strategy)}
            className={cn(
              'w-full p-3 rounded-lg border text-left transition-all duration-200',
              selectedStrategy.name === strategy.name
                ? 'border-blue-500 bg-blue-50'
                : 'border-ink-200 hover:border-ink-300 hover:bg-ink-50'
            )}
          >
            <div className="flex items-center justify-between mb-2">
              <span className={cn(
                'font-medium',
                selectedStrategy.name === strategy.name ? 'text-blue-700' : 'text-ink-700'
              )}>
                {strategy.name}
              </span>
              {selectedStrategy.name === strategy.name && (
                <Check size={14} className="text-blue-500" />
              )}
            </div>
            <p className="text-xs text-ink-500 mb-2">{strategy.description}</p>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-green-500" />
                <span className="text-xs text-ink-500">基本面 {strategy.weights.fundamental}%</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-blue-500" />
                <span className="text-xs text-ink-500">技术面 {strategy.weights.technical}%</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-purple-500" />
                <span className="text-xs text-ink-500">资金面 {strategy.weights.money}%</span>
              </div>
            </div>
          </button>
        ))}
      </div>

      <div className="mt-4 pt-4 border-t border-ink-100">
        <button
          onClick={() => setShowCustom(!showCustom)}
          className="flex items-center gap-2 text-sm text-ink-600 hover:text-ink-800"
        >
          <Settings size={14} />
          {showCustom ? '收起自定义权重' : '自定义权重配置'}
        </button>

        {showCustom && (
          <div className="mt-3 space-y-3">
            <div>
              <label className="flex items-center justify-between text-xs text-ink-500 mb-1">
                <span className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-green-500" />
                  基本面权重
                </span>
                <span>{tempWeights.fundamental}%</span>
              </label>
              <input
                type="range"
                min="0"
                max="100"
                value={tempWeights.fundamental}
                onChange={(e) => handleWeightChange('fundamental', Number(e.target.value))}
                className="w-full"
              />
            </div>

            <div>
              <label className="flex items-center justify-between text-xs text-ink-500 mb-1">
                <span className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-blue-500" />
                  技术面权重
                </span>
                <span>{tempWeights.technical}%</span>
              </label>
              <input
                type="range"
                min="0"
                max="100"
                value={tempWeights.technical}
                onChange={(e) => handleWeightChange('technical', Number(e.target.value))}
                className="w-full"
              />
            </div>

            <div>
              <label className="flex items-center justify-between text-xs text-ink-500 mb-1">
                <span className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-purple-500" />
                  资金面权重
                </span>
                <span>{tempWeights.money}%</span>
              </label>
              <input
                type="range"
                min="0"
                max="100"
                value={tempWeights.money}
                onChange={(e) => handleWeightChange('money', Number(e.target.value))}
                className="w-full"
              />
            </div>

            <div className="flex items-center justify-between text-sm">
              <span className="text-ink-500">权重总和</span>
              <span className={cn(
                'font-medium',
                tempWeights.fundamental + tempWeights.technical + tempWeights.money === 100
                  ? 'text-green-600'
                  : 'text-red-600'
              )}>
                {tempWeights.fundamental + tempWeights.technical + tempWeights.money}%
              </span>
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => {
                  setTempWeights({ fundamental: 35, technical: 35, money: 30 });
                }}
                className="flex-1 px-3 py-2 text-xs text-ink-600 border border-ink-200 rounded-lg hover:bg-ink-50"
              >
                重置
              </button>
              <button
                onClick={handleApplyCustom}
                disabled={tempWeights.fundamental + tempWeights.technical + tempWeights.money !== 100}
                className="flex-1 px-3 py-2 text-xs text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                应用配置
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}