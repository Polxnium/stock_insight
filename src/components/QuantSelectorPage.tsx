/**
 * 量化选股页面组件
 * 支持多种选股范围、筛选条件和可视化分析
 */

import { useState, useMemo } from 'react';
import { TrendingUp, RefreshCw, Filter, Info, AlertTriangle, Award, Target, Activity, Download, BarChart3 } from 'lucide-react';
import { useAppStore } from '@/store';
import { cn, colorClass, fmtPrice } from '@/lib/format';
import { getGradeBgColor, getGradeColor, getGradeDescription } from '@/strategies/scoring';
import { getRiskLevelBgColor, getRiskLevelColor, getRiskLevelDescription } from '@/strategies/riskFilter';
import { StrategySelector, STRATEGIES, type StrategyConfig } from './StockFilter/StrategySelector';
import type { SelectorStock } from '@/strategies/quantSelector';

// 选股范围类型
type ScopeType = 'watchlist' | 'industry' | 'concept' | 'index';

// Mock 数据 - 行业列表
const INDUSTRIES = [
  { code: 'bank', name: '银行' },
  { code: 'tech', name: '科技' },
  { code: 'medicine', name: '医药' },
];

// Mock 数据 - 概念列表
const CONCEPTS = [
  { code: 'AI', name: '人工智能' },
  { code: '5G', name: '5G概念' },
  { code: 'newEnergy', name: '新能源' },
];

// Mock 数据 - 指数列表
const INDICES = [
  { code: 'sh000001', name: '上证指数' },
  { code: 'sz399001', name: '深证成指' },
  { code: 'sh000300', name: '沪深300' },
];

interface QuantSelectorPageProps {
  stocks: SelectorStock[];
  loading: boolean;
  updatedAt: number | null;
  onRefresh: () => void;
}

export function QuantSelectorPage({ stocks, loading, updatedAt, onRefresh }: QuantSelectorPageProps) {
  const watchlist = useAppStore((s) => s.watchlist);
  const setStrategyWeights = useAppStore((s) => s.setStrategyWeights);
  
  // 策略选择状态
  const [selectedStrategy, setSelectedStrategy] = useState<StrategyConfig>(STRATEGIES[1]);
  const [customWeights, setCustomWeights] = useState({ fundamental: 35, technical: 35, money: 30 });

  // 策略切换时同步到 store
  const handleStrategySelect = (strategy: StrategyConfig) => {
    setSelectedStrategy(strategy);
    const weights = strategy.weights;
    setCustomWeights(weights);
    setStrategyWeights(weights);
  };
  
  // 筛选状态 - 降低门槛，让更多股票显示
  const [minScore, setMinScore] = useState(0);
  const [riskFilter, setRiskFilter] = useState(false);
  const [sortBy, setSortBy] = useState<'adjusted' | 'fundamental' | 'technical' | 'money'>('adjusted');
  
  // 新增：选股范围状态
  const [scope, setScope] = useState<ScopeType>('watchlist');
  const [selectedIndustry, setSelectedIndustry] = useState('');
  const [selectedConcept, setSelectedConcept] = useState('');
  const [selectedIndex, setSelectedIndex] = useState('');
  
  // 计算统计数据
  const stats = useMemo(() => {
    if (stocks.length === 0) return { avgScore: 0, avgRisk: 0, aCount: 0, bCount: 0, cCount: 0, dCount: 0 };
    
    const avgScore = stocks.reduce((sum, s) => sum + s.adjustedScore, 0) / stocks.length;
    const avgRisk = stocks.reduce((sum, s) => sum + (s.risk.riskLevel === 'high' ? 3 : s.risk.riskLevel === 'medium' ? 2 : 1), 0) / stocks.length;
    
    return {
      avgScore: Math.round(avgScore * 10) / 10,
      avgRisk: Math.round(avgRisk * 10) / 10,
      aCount: stocks.filter(s => s.score.grade === 'A').length,
      bCount: stocks.filter(s => s.score.grade === 'B').length,
      cCount: stocks.filter(s => s.score.grade === 'C').length,
      dCount: stocks.filter(s => s.score.grade === 'D').length,
    };
  }, [stocks]);
  
  // 排序和筛选后的股票列表
  const filteredStocks = useMemo(() => {
    let result = [...stocks];
    
    // 按评分排序
    result.sort((a, b) => {
      switch (sortBy) {
        case 'fundamental': return b.score.fundamentalScore - a.score.fundamentalScore;
        case 'technical': return b.score.technicalScore - a.score.technicalScore;
        case 'money': return b.score.moneyScore - a.score.moneyScore;
        default: return b.adjustedScore - a.adjustedScore;
      }
    });
    
    // 过滤低分和高风险
    return result.filter(s => {
      if (s.adjustedScore < minScore) return false;
      if (riskFilter && s.risk.isExcluded) return false;
      return true;
    });
  }, [stocks, sortBy, minScore, riskFilter]);

  const handleExport = () => {
    const data = filteredStocks.map(s => ({
      rank: s.rank,
      name: s.name,
      code: s.code,
      price: s.price,
      changePct: s.changePct,
      score: s.score.totalScore,
      adjustedScore: s.adjustedScore,
      grade: s.score.grade,
      riskLevel: s.risk.riskLevel,
    }));
    
    const csv = [
      ['排名', '股票名称', '代码', '价格', '涨跌幅', '综合评分', '风险调整后', '评级', '风险等级'].join(','),
      ...data.map(d => [
        d.rank,
        `"${d.name}"`,
        d.code,
        d.price.toFixed(2),
        `${d.changePct >= 0 ? '+' : ''}${d.changePct.toFixed(2)}%`,
        d.score.toFixed(1),
        d.adjustedScore.toFixed(1),
        d.grade,
        d.riskLevel === 'high' ? '高' : d.riskLevel === 'medium' ? '中' : '低'
      ].join(','))
    ].join('\n');
    
    const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `quant-stocks-${Date.now()}.csv`;
    link.click();
  };

  return (
    <div className="space-y-4">
      {/* 页面标题栏 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-gradient-to-br from-red-500 to-orange-500">
            <TrendingUp size={20} className="text-white" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-ink-900">量化选股</h2>
            <p className="text-xs text-ink-400">基于多因子模型的智能选股系统</p>
          </div>
        </div>
        
        <div className="flex items-center gap-3">
          <span className="text-xs text-ink-400">
            共 {filteredStocks.length} 只股票 · 更新于 {updatedAt ? new Date(updatedAt).toLocaleTimeString() : '--'}
          </span>
          <button
            onClick={onRefresh}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-ink-900 rounded-lg hover:bg-ink-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? <RefreshCw size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            {loading ? '刷新中' : '刷新'}
          </button>
        </div>
      </div>

      {/* 策略选择器 */}
      <StrategySelector
        selectedStrategy={selectedStrategy}
        onSelect={handleStrategySelect}
        customWeights={customWeights}
        onCustomWeightsChange={(weights: { fundamental: number; technical: number; money: number }) => {
          setCustomWeights(weights);
          setStrategyWeights(weights);
        }}
      />

      {/* 统计卡片 */}
      <div className="grid grid-cols-6 gap-3">
        <StatCard icon={<Award size={16} />} label="平均评分" value={stats.avgScore} suffix="分" />
        <StatCard icon={<AlertTriangle size={16} />} label="平均风险" value={stats.avgRisk} suffix="级" />
        <StatCard icon={<Target size={16} className="text-green-500" />} label="A级股票" value={stats.aCount} suffix="只" />
        <StatCard icon={<Target size={16} className="text-blue-500" />} label="B级股票" value={stats.bCount} suffix="只" />
        <StatCard icon={<Target size={16} className="text-yellow-500" />} label="C级股票" value={stats.cCount} suffix="只" />
        <StatCard icon={<Target size={16} className="text-red-500" />} label="D级股票" value={stats.dCount} suffix="只" />
      </div>

      {/* 筛选面板 */}
      <div className="rounded-lg border border-ink-200 bg-white p-4">
        <div className="flex items-center gap-2 mb-4">
          <Filter size={14} className="text-ink-400" />
          <span className="text-sm font-semibold text-ink-900">筛选条件</span>
        </div>
        
        <div className="grid grid-cols-6 gap-4">
          {/* 选股范围 */}
          <div>
            <label className="block text-xs text-ink-500 mb-1">选股范围</label>
            <select
              value={scope}
              onChange={(e) => setScope(e.target.value as ScopeType)}
              className="w-full px-3 py-2 text-sm border border-ink-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-ink-400"
            >
              <option value="watchlist">自选股</option>
              <option value="industry">行业板块</option>
              <option value="concept">概念题材</option>
              <option value="index">指数成分</option>
            </select>
          </div>
          
          {/* 行业选择 */}
          {scope === 'industry' && (
            <div>
              <label className="block text-xs text-ink-500 mb-1">选择行业</label>
              <select
                value={selectedIndustry}
                onChange={(e) => setSelectedIndustry(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-ink-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-ink-400"
              >
                <option value="">请选择行业</option>
                {INDUSTRIES.map(ind => (
                  <option key={ind.code} value={ind.code}>{ind.name}</option>
                ))}
              </select>
            </div>
          )}
          
          {/* 概念选择 */}
          {scope === 'concept' && (
            <div>
              <label className="block text-xs text-ink-500 mb-1">选择概念</label>
              <select
                value={selectedConcept}
                onChange={(e) => setSelectedConcept(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-ink-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-ink-400"
              >
                <option value="">请选择概念</option>
                {CONCEPTS.map(c => (
                  <option key={c.code} value={c.code}>{c.name}</option>
                ))}
              </select>
            </div>
          )}
          
          {/* 指数选择 */}
          {scope === 'index' && (
            <div>
              <label className="block text-xs text-ink-500 mb-1">选择指数</label>
              <select
                value={selectedIndex}
                onChange={(e) => setSelectedIndex(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-ink-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-ink-400"
              >
                <option value="">请选择指数</option>
                {INDICES.map(i => (
                  <option key={i.code} value={i.code}>{i.name}</option>
                ))}
              </select>
            </div>
          )}
          
          {/* 自选股数量提示 */}
          {scope === 'watchlist' && (
            <div className="flex items-center">
              <span className="text-xs text-ink-400">
                当前自选股 <span className="font-medium text-ink-700">{watchlist.length}</span> 只
              </span>
            </div>
          )}
          
          {/* 最低评分 */}
          <div>
            <label className="block text-xs text-ink-500 mb-1">最低评分: {minScore}分</label>
            <input
              type="range"
              min="0"
              max="100"
              value={minScore}
              onChange={(e) => setMinScore(Number(e.target.value))}
              className="w-full"
            />
          </div>
          
          {/* 风险过滤 */}
          <div className="flex items-center">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={riskFilter}
                onChange={(e) => setRiskFilter(e.target.checked)}
                className="w-4 h-4 rounded border-ink-300 text-ink-900 focus:ring-ink-400"
              />
              <span className="text-xs text-ink-600">过滤高风险股票</span>
            </label>
          </div>
          
          {/* 排序方式 */}
          <div>
            <label className="block text-xs text-ink-500 mb-1">排序方式</label>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
              className="w-full px-3 py-2 text-sm border border-ink-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-ink-400"
            >
              <option value="adjusted">风险调整得分</option>
              <option value="fundamental">基本面得分</option>
              <option value="technical">技术面得分</option>
              <option value="money">资金面得分</option>
            </select>
          </div>
        </div>
      </div>

      {/* 选股结果 */}
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium text-ink-700">选股结果</span>
        <button
          onClick={handleExport}
          disabled={filteredStocks.length === 0}
          className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-ink-600 bg-ink-100 rounded hover:bg-ink-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          <Download size={12} />
          导出 CSV
        </button>
      </div>
      
      {filteredStocks.length === 0 ? (
        <div className="rounded-lg border border-ink-200 bg-white p-8 text-center">
          <Activity size={48} className="mx-auto text-ink-300 mb-3" />
          <p className="text-sm text-ink-500">暂无符合条件的股票</p>
          <p className="text-xs text-ink-400 mt-1">请调整筛选条件后重试</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {filteredStocks.map((stock) => (
            <StockCard key={stock.code} stock={stock} />
          ))}
        </div>
      )}

      {/* 使用说明 */}
      <div className="rounded-lg border border-ink-200 bg-white p-4">
        <div className="flex items-center gap-2 mb-3">
          <Info size={14} className="text-ink-400" />
          <span className="text-sm font-semibold text-ink-900">使用说明</span>
        </div>
        <div className="grid grid-cols-3 gap-4 text-xs text-ink-500">
          <div>
            <p className="font-medium text-ink-700 mb-1">选股范围</p>
            <p>支持自选股、行业板块、概念题材和指数成分股多种范围</p>
          </div>
          <div>
            <p className="font-medium text-ink-700 mb-1">评分体系</p>
            <p>S级（85+）、A级（70-84）、B级（55-69）、C级（40-54）、D级（&lt;40）</p>
          </div>
          <div>
            <p className="font-medium text-ink-700 mb-1">风险过滤</p>
            <p>自动排除ST、退市风险、高负债率等高风险股票</p>
          </div>
        </div>
      </div>
    </div>
  );
}

// 统计卡片组件
function StatCard({ icon, label, value, suffix }: { icon: React.ReactNode; label: string; value: number; suffix: string }) {
  return (
    <div className="rounded-lg border border-ink-200 bg-white p-3">
      <div className="flex items-center gap-2 mb-1">
        {icon}
        <span className="text-xs text-ink-400">{label}</span>
      </div>
      <div className="text-lg font-bold text-ink-900">
        {value}{suffix}
      </div>
    </div>
  );
}

// 股票卡片组件
function StockCard({ stock }: { stock: SelectorStock }) {
  const { score, risk } = stock;
  const setSelectedCode = useAppStore((s) => s.setSelectedCode);
  
  const riskLevelText = risk.riskLevel === 'high' ? '高' : risk.riskLevel === 'medium' ? '中' : '低';

  return (
    <div 
      className="rounded-lg border border-ink-200 bg-white p-3 cursor-pointer hover:bg-ink-50 hover:border-ink-300 transition-all duration-200"
      onClick={() => setSelectedCode(stock.code)}
    >
      {/* 排名 + 股票名 + 价格 + 涨跌幅 + 风险 */}
      <div className="flex items-center gap-2 mb-3">
        {/* 排名 */}
        <span className={`w-5 h-5 flex items-center justify-center rounded-full text-[10px] font-bold shrink-0 ${
          stock.rank === 1 ? 'bg-gradient-to-br from-yellow-300 to-yellow-500 text-white shadow-sm' :
          stock.rank === 2 ? 'bg-gradient-to-br from-gray-200 to-gray-400 text-white shadow-sm' :
          stock.rank === 3 ? 'bg-gradient-to-br from-orange-300 to-orange-500 text-white shadow-sm' :
          'bg-ink-100 text-ink-500'
        }`}>
          {stock.rank}
        </span>
        
        {/* 股票名称 */}
        <span className="font-semibold text-ink-800 text-sm truncate flex-1">{stock.name}</span>
        
        {/* 价格 */}
        <span className="tabular text-base font-bold text-ink-900 shrink-0">{fmtPrice(stock.price)}</span>
        
        {/* 涨跌幅 */}
        <span className={cn('tabular text-xs font-semibold shrink-0', colorClass(stock.changePct))}>
          {stock.changePct >= 0 ? '+' : ''}{stock.changePct.toFixed(2)}%
        </span>
        
        {/* 风险标签 */}
        <span className={cn('px-1.5 py-0.5 rounded text-[10px] font-semibold shrink-0', getRiskLevelBgColor(risk.riskLevel))}>
          {riskLevelText}
        </span>
      </div>
      
      {/* 维度评分 */}
      <div className="grid grid-cols-3 gap-2 mb-3">
        <DimensionScore label="基本面" value={score.fundamentalScore} />
        <DimensionScore label="技术面" value={score.technicalScore} />
        <DimensionScore label="资金面" value={score.moneyScore} />
      </div>
      
      {/* 底部：综合评分和评级 */}
      <div className="flex items-center justify-between pt-2 border-t border-ink-100">
        <div className="flex items-center gap-2">
          <span className="text-xl font-bold" style={{ color: getGradeColor(score.grade).replace('text-', '') }}>
            {score.totalScore.toFixed(1)}
          </span>
          <span className={cn('px-2 py-0.5 rounded text-xs font-semibold', getGradeBgColor(score.grade))}>
            {score.grade}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-ink-400">
            风险调整: {stock.adjustedScore.toFixed(1)}
          </span>
          <button
            onClick={(e) => { e.stopPropagation(); setSelectedCode(stock.code); }}
            className="flex items-center gap-1 px-2 py-1 text-[10px] font-medium text-white bg-blue-600 rounded hover:bg-blue-700 transition-colors"
          >
            <BarChart3 size={10} />
            分析
          </button>
        </div>
      </div>

      {/* 数据质量提示 */}
      {stock.dataQuality && stock.dataQuality.missingSources.length > 0 && (
        <div className="mt-2 pt-2 border-t border-ink-100">
          <span className="text-[10px] text-amber-600">
            ⚠ 数据缺失: {stock.dataQuality.missingSources.join('、')}
          </span>
        </div>
      )}
    </div>
  );
}

// 维度评分组件
function DimensionScore({ label, value }: { label: string; value: number }) {
  const color = value >= 70 ? 'text-green-500' : value >= 50 ? 'text-yellow-500' : 'text-red-500';
  
  return (
    <div className="text-center">
      <div className="text-[10px] text-ink-400 mb-0.5">{label}</div>
      <div className={cn('text-sm font-bold', color)}>{value.toFixed(1)}</div>
    </div>
  );
}