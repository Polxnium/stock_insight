/**
 * 量化选股展示组件
 * 展示量化分析结果和选股排名
 */

import { useState } from 'react';
import { TrendingUp, AlertTriangle, Info, ChevronDown, ChevronUp } from 'lucide-react';
import { useAppStore } from '@/store';
import { cn, colorClass, fmtPrice, fmtPct } from '@/lib/format';
import { getGradeBgColor, getGradeColor } from '@/strategies/scoring';
import { getRiskLevelBgColor, getRiskLevelColor, getRiskLevelDescription } from '@/strategies/riskFilter';
import type { SelectorStock } from '@/strategies/quantSelector';

interface ScoreCardProps {
  stock: SelectorStock;
  onSelect: (code: string) => void;
}

function ScoreCard({ stock, onSelect }: ScoreCardProps) {
  const [expanded, setExpanded] = useState(false);
  const { score, risk } = stock;

  return (
    <div className="rounded-lg border border-ink-200 bg-white overflow-hidden">
      {/* 主卡片 */}
      <div 
        className="flex items-center justify-between px-3 py-2 cursor-pointer hover:bg-ink-50 transition-colors"
        onClick={() => onSelect(stock.code)}
      >
        <div className="flex items-center gap-2">
          {/* 排名 */}
          <span className="w-5 h-5 flex items-center justify-center rounded-full bg-ink-100 text-[10px] font-semibold text-ink-600">
            {stock.rank}
          </span>
          
          {/* 股票名称 */}
          <span className="text-sm font-medium text-ink-800">{stock.name}</span>
        </div>

        <div className="flex items-center gap-3">
          {/* 价格和涨跌幅 */}
          <div className="text-right">
            <span className="tabular text-sm font-medium">{fmtPrice(stock.price)}</span>
            <span className={cn('tabular text-xs ml-1', colorClass(stock.changePct))}>
              {stock.changePct >= 0 ? '+' : ''}{stock.changePct.toFixed(2)}%
            </span>
          </div>

          {/* 评级 */}
          <span className={cn('px-1.5 py-0.5 rounded text-[10px] font-medium', getGradeBgColor(score.grade))}>
            {score.totalScore.toFixed(0)}{score.grade}
          </span>

          {/* 展开按钮 */}
          <button 
            onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
            className="p-1 text-ink-400 hover:text-ink-600"
          >
            {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
        </div>
      </div>

      {/* 展开详情 */}
      {expanded && (
        <div className="border-t border-ink-100 bg-ink-50/50">
          {/* 维度评分 */}
          <div className="grid grid-cols-3 gap-4 px-4 py-3">
            {score.dimensions.map((dim) => (
              <div key={dim.name} className="text-center">
                <div className="text-xs text-ink-500 mb-1">{dim.name}</div>
                <div className="text-lg font-bold text-ink-900">{dim.score.toFixed(1)}</div>
                <div className="text-[10px] text-ink-400 mt-0.5">权重 {dim.weight}%</div>
              </div>
            ))}
          </div>

          {/* 风险提示 */}
          {risk.riskItems.length > 0 && (
            <div className="border-t border-ink-100 px-4 py-3">
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangle size={14} className={getRiskLevelColor(risk.riskLevel)} />
                <span className="text-xs font-medium" style={{ color: getRiskLevelColor(risk.riskLevel).replace('text-', '') }}>
                  风险提示 ({getRiskLevelDescription(risk.riskLevel)})
                </span>
              </div>
              <div className="space-y-1">
                {risk.riskItems.map((item) => (
                  <div key={item.code} className="flex items-center gap-2 text-xs text-ink-500">
                    <span className={cn('w-1.5 h-1.5 rounded-full', item.severity === 'danger' ? 'bg-red-500' : 'bg-yellow-500')} />
                    <span>{item.name}: {item.description}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 评级说明 */}
          <div className="border-t border-ink-100 px-4 py-3">
            <div className="flex items-center gap-2 mb-1">
              <Info size={14} className="text-ink-400" />
              <span className="text-xs text-ink-500">评级说明</span>
            </div>
            <p className="text-xs text-ink-500">{score.gradeDescription}</p>
          </div>
        </div>
      )}
    </div>
  );
}

export function StockSelector({ stocks }: { stocks: SelectorStock[] }) {
  const setSelectedCode = useAppStore((s) => s.setSelectedCode);

  if (stocks.length === 0) {
    return (
      <div className="rounded-lg border border-ink-200 bg-white p-8 text-center">
        <TrendingUp size={32} className="mx-auto text-ink-300 mb-3" />
        <p className="text-sm text-ink-500">暂无选股结果</p>
        <p className="text-xs text-ink-400 mt-1">请先在自选股中添加股票</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <TrendingUp size={16} className="text-up" />
          <h2 className="text-sm font-semibold text-ink-900">量化选股</h2>
        </div>
        <span className="text-xs text-ink-400">基于多因子模型评分</span>
      </div>

      <div className="space-y-2">
        {stocks.map((stock) => (
          <ScoreCard 
            key={stock.code} 
            stock={stock} 
            onSelect={setSelectedCode}
          />
        ))}
      </div>
    </div>
  );
}