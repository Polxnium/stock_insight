import { Filter, BarChart3, AlertTriangle, TrendingUp, Volume2 } from 'lucide-react';
import { cn } from '@/lib/format';

export type ScopeType = 'watchlist' | 'industry' | 'concept' | 'index' | 'market';
export type MarketCapType = 'all' | 'small' | 'medium' | 'large' | 'xlarge';

export interface FilterOptions {
  scope: ScopeType;
  selectedIndustry: string;
  selectedConcept: string;
  selectedIndex: string;
  minScore: number;
  riskLevels: Array<'low' | 'medium' | 'high'>;
  marketCap: MarketCapType;
  minAmount: number;
  filterExtreme: boolean;
  sortBy: 'adjusted' | 'fundamental' | 'technical' | 'money' | 'change' | 'turnover';
}

const INDUSTRIES = [
  { code: 'bank', name: '银行' },
  { code: 'tech', name: '科技' },
  { code: 'medicine', name: '医药' },
  { code: 'consume', name: '消费' },
  { code: 'realestate', name: '地产' },
  { code: 'energy', name: '能源' },
  { code: 'manufacture', name: '制造' },
  { code: 'finance', name: '金融' },
];

const CONCEPTS = [
  { code: 'AI', name: '人工智能' },
  { code: '5G', name: '5G概念' },
  { code: 'newEnergy', name: '新能源' },
  { code: 'chip', name: '半导体' },
  { code: 'quantum', name: '量子计算' },
  { code: 'robot', name: '机器人' },
  { code: 'biotech', name: '生物科技' },
  { code: 'metaverse', name: '元宇宙' },
];

const INDICES = [
  { code: 'sh000001', name: '上证指数' },
  { code: 'sz399001', name: '深证成指' },
  { code: 'sh000300', name: '沪深300' },
  { code: 'sh000905', name: '中证500' },
  { code: 'sz399006', name: '创业板指' },
  { code: 'sh000852', name: '中证1000' },
];

const MARKET_CAP_OPTIONS: { value: MarketCapType; label: string; desc: string }[] = [
  { value: 'all', label: '全部', desc: '不限市值' },
  { value: 'small', label: '小盘', desc: '<50亿' },
  { value: 'medium', label: '中盘', desc: '50-200亿' },
  { value: 'large', label: '大盘', desc: '200-1000亿' },
  { value: 'xlarge', label: '超大', desc: '>1000亿' },
];

interface FilterPanelProps {
  options: FilterOptions;
  watchlistCount: number;
  onOptionsChange: (options: FilterOptions) => void;
}

export function FilterPanel({ options, watchlistCount, onOptionsChange }: FilterPanelProps) {
  const handleChange = <K extends keyof FilterOptions>(key: K, value: FilterOptions[K]) => {
    onOptionsChange({ ...options, [key]: value });
  };

  const handleRiskToggle = (level: 'low' | 'medium' | 'high') => {
    const newRiskLevels = options.riskLevels.includes(level)
      ? options.riskLevels.filter(r => r !== level)
      : [...options.riskLevels, level];
    onOptionsChange({ ...options, riskLevels: newRiskLevels.length > 0 ? newRiskLevels : ['low', 'medium', 'high'] });
  };

  return (
    <div className="rounded-lg border border-ink-200 bg-white p-4">
      <div className="flex items-center gap-2 mb-4">
        <Filter size={14} className="text-ink-400" />
        <span className="text-sm font-semibold text-ink-900">筛选条件</span>
      </div>

      <div className="space-y-4">
        <div>
          <label className="block text-xs text-ink-500 mb-1.5">选股范围</label>
          <select
            value={options.scope}
            onChange={(e) => handleChange('scope', e.target.value as ScopeType)}
            className="w-full px-3 py-2 text-sm border border-ink-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-ink-400"
          >
            <option value="watchlist">自选股</option>
            <option value="industry">行业板块</option>
            <option value="concept">概念题材</option>
            <option value="index">指数成分</option>
            <option value="market">全市场</option>
          </select>
          {options.scope === 'watchlist' && (
            <span className="text-xs text-ink-400 mt-1 block">当前自选股 {watchlistCount} 只</span>
          )}
        </div>

        {options.scope === 'industry' && (
          <div>
            <label className="block text-xs text-ink-500 mb-1.5">选择行业</label>
            <select
              value={options.selectedIndustry}
              onChange={(e) => handleChange('selectedIndustry', e.target.value)}
              className="w-full px-3 py-2 text-sm border border-ink-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-ink-400"
            >
              <option value="">全部行业</option>
              {INDUSTRIES.map(ind => (
                <option key={ind.code} value={ind.code}>{ind.name}</option>
              ))}
            </select>
          </div>
        )}

        {options.scope === 'concept' && (
          <div>
            <label className="block text-xs text-ink-500 mb-1.5">选择概念</label>
            <select
              value={options.selectedConcept}
              onChange={(e) => handleChange('selectedConcept', e.target.value)}
              className="w-full px-3 py-2 text-sm border border-ink-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-ink-400"
            >
              <option value="">全部概念</option>
              {CONCEPTS.map(c => (
                <option key={c.code} value={c.code}>{c.name}</option>
              ))}
            </select>
          </div>
        )}

        {options.scope === 'index' && (
          <div>
            <label className="block text-xs text-ink-500 mb-1.5">选择指数</label>
            <select
              value={options.selectedIndex}
              onChange={(e) => handleChange('selectedIndex', e.target.value)}
              className="w-full px-3 py-2 text-sm border border-ink-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-ink-400"
            >
              <option value="">全部指数</option>
              {INDICES.map(i => (
                <option key={i.code} value={i.code}>{i.name}</option>
              ))}
            </select>
          </div>
        )}

        <div className="pt-2 border-t border-ink-100">
          <label className="block text-xs text-ink-500 mb-1.5 flex items-center gap-1.5">
            <BarChart3 size={12} />
            市值区间
          </label>
          <div className="grid grid-cols-5 gap-1.5">
            {MARKET_CAP_OPTIONS.map(option => (
              <button
                key={option.value}
                onClick={() => handleChange('marketCap', option.value)}
                className={cn(
                  'px-2 py-1.5 text-xs rounded-lg transition-colors',
                  options.marketCap === option.value
                    ? 'bg-blue-600 text-white'
                    : 'bg-ink-100 text-ink-600 hover:bg-ink-200'
                )}
                title={option.desc}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-xs text-ink-500 mb-1.5">最低评分: {options.minScore}分</label>
          <input
            type="range"
            min="0"
            max="100"
            value={options.minScore}
            onChange={(e) => handleChange('minScore', Number(e.target.value))}
            className="w-full"
          />
        </div>

        <div className="pt-2 border-t border-ink-100">
          <label className="block text-xs text-ink-500 mb-1.5 flex items-center gap-1.5">
            <AlertTriangle size={12} />
            风险等级
          </label>
          <div className="flex gap-2">
            {(['low', 'medium', 'high'] as const).map(level => (
              <button
                key={level}
                onClick={() => handleRiskToggle(level)}
                className={cn(
                  'flex-1 px-3 py-1.5 text-xs rounded-lg border transition-colors',
                  options.riskLevels.includes(level)
                    ? level === 'low' ? 'border-green-500 bg-green-50 text-green-700'
                    : level === 'medium' ? 'border-yellow-500 bg-yellow-50 text-yellow-700'
                    : 'border-red-500 bg-red-50 text-red-700'
                    : 'border-ink-200 text-ink-500 hover:bg-ink-50'
                )}
              >
                {level === 'low' ? '低风险' : level === 'medium' ? '中风险' : '高风险'}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-xs text-ink-500 mb-1.5 flex items-center gap-1.5">
            <Volume2 size={12} />
            最小日均成交额: {options.minAmount}亿
          </label>
          <input
            type="range"
            min="0"
            max="50"
            step="1"
            value={options.minAmount}
            onChange={(e) => handleChange('minAmount', Number(e.target.value))}
            className="w-full"
          />
        </div>

        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={options.filterExtreme}
            onChange={(e) => handleChange('filterExtreme', e.target.checked)}
            className="w-4 h-4 rounded border-ink-300 text-ink-900 focus:ring-ink-400"
          />
          <span className="text-xs text-ink-600">过滤异常涨跌(±10%)</span>
        </label>

        <div className="pt-2 border-t border-ink-100">
          <label className="block text-xs text-ink-500 mb-1.5 flex items-center gap-1.5">
            <TrendingUp size={12} />
            排序方式
          </label>
          <select
            value={options.sortBy}
            onChange={(e) => handleChange('sortBy', e.target.value as FilterOptions['sortBy'])}
            className="w-full px-3 py-2 text-sm border border-ink-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-ink-400"
          >
            <option value="adjusted">风险调整得分</option>
            <option value="fundamental">基本面得分</option>
            <option value="technical">技术面得分</option>
            <option value="money">资金面得分</option>
            <option value="change">当日涨跌幅</option>
            <option value="turnover">换手率</option>
          </select>
        </div>
      </div>
    </div>
  );
}