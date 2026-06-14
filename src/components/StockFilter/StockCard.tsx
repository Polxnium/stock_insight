import { useState } from 'react';
import { ChevronDown, ChevronUp, Star, AlertTriangle, Plus, Eye, AlertCircle, BarChart3 } from 'lucide-react';
import { useAppStore } from '@/store';
import { cn, colorClass, fmtPrice } from '@/lib/format';
import { getGradeBgColor, getGradeColor, getGradeDescription } from '@/strategies/scoring';
import { getRiskLevelBgColor, getRiskLevelColor, getRiskLevelDescription } from '@/strategies/riskFilter';
import type { SelectorStock } from '@/strategies/quantSelector';
import { FactorRadar } from './FactorRadar';

interface StockCardProps {
  stock: SelectorStock;
  onSelect: (code: string) => void;
}

export function StockCard({ stock, onSelect }: StockCardProps) {
  const [expanded, setExpanded] = useState(false);
  const { score, risk } = stock;
  const watchlist = useAppStore((s) => s.watchlist);
  const addStock = useAppStore((s) => s.addStock);
  const removeStock = useAppStore((s) => s.removeStock);

  const isInWatchlist = watchlist.some(item => item.code === stock.code);
  const riskLevelText = risk.riskLevel === 'high' ? '高' : risk.riskLevel === 'medium' ? '中' : '低';

  const handleAddWatchlist = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isInWatchlist) {
      removeStock(stock.code);
    } else {
      addStock({ code: stock.code, alias: stock.name });
    }
  };

  return (
    <div className="rounded-lg border border-ink-200 bg-white overflow-hidden hover:border-ink-300 transition-colors">
      <div
        className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-ink-50 transition-colors"
        onClick={() => onSelect(stock.code)}
      >
        <div className="flex items-center gap-3">
          <span className={`w-6 h-6 flex items-center justify-center rounded-full text-xs font-bold shrink-0 ${
            stock.rank === 1 ? 'bg-gradient-to-br from-yellow-300 to-yellow-500 text-white shadow-sm' :
            stock.rank === 2 ? 'bg-gradient-to-br from-gray-200 to-gray-400 text-white shadow-sm' :
            stock.rank === 3 ? 'bg-gradient-to-br from-orange-300 to-orange-500 text-white shadow-sm' :
            'bg-ink-100 text-ink-600'
          }`}>
            {stock.rank}
          </span>

          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-ink-800 truncate">{stock.name}</span>
              <span className="text-xs text-ink-400">{stock.code}</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="text-right">
            <span className="tabular text-base font-bold text-ink-900">{fmtPrice(stock.price)}</span>
            <span className={cn('tabular text-xs ml-2', colorClass(stock.changePct))}>
              {stock.changePct >= 0 ? '+' : ''}{stock.changePct.toFixed(2)}%
            </span>
          </div>

          <span className={cn('px-2 py-0.5 rounded text-xs font-semibold', getGradeBgColor(score.grade))}>
            {score.totalScore.toFixed(0)}{score.grade}
          </span>

          <span className={cn('px-2 py-0.5 rounded text-xs font-semibold', getRiskLevelBgColor(risk.riskLevel))}>
            {riskLevelText}风险
          </span>

          <button
            onClick={(e) => { e.stopPropagation(); handleAddWatchlist(e); }}
            className={cn(
              'p-1.5 rounded-lg transition-colors',
              isInWatchlist ? 'bg-yellow-100 text-yellow-600' : 'bg-ink-100 text-ink-400 hover:bg-ink-200'
            )}
          >
            <Star size={14} fill={isInWatchlist ? 'currentColor' : 'none'} />
          </button>

          <button
            onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
            className="p-1.5 text-ink-400 hover:text-ink-600 hover:bg-ink-100 rounded-lg transition-colors"
          >
            {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-ink-100 bg-ink-50/50">
          <div className="grid grid-cols-3 gap-4 px-4 py-3">
            {score.dimensions.map((dim) => (
              <div key={dim.name} className="text-center">
                <div className="text-xs text-ink-500 mb-1">{dim.name}</div>
                <div className={`text-lg font-bold ${
                  dim.score >= 70 ? 'text-green-600' : dim.score >= 50 ? 'text-yellow-600' : 'text-red-600'
                }`}>
                  {dim.score.toFixed(1)}
                </div>
                <div className="text-[10px] text-ink-400 mt-0.5">权重 {dim.weight}%</div>
              </div>
            ))}
          </div>

          <div className="border-t border-ink-100 px-4 py-3">
            <div className="flex items-center gap-4">
              <div className="flex-1">
                <div className="text-xs text-ink-500 mb-2">因子雷达图</div>
                <div className="flex justify-center">
                  <FactorRadar stock={stock} />
                </div>
              </div>
            </div>
          </div>

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

          <div className="border-t border-ink-100 px-4 py-3">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs text-ink-500 mb-1">评级说明</div>
                <p className="text-xs text-ink-600">{score.gradeDescription}</p>
              </div>
              <div className="text-right">
                <div className="text-xs text-ink-500 mb-1">风险调整后得分</div>
                <p className="text-lg font-bold text-blue-600">{stock.adjustedScore.toFixed(1)}</p>
              </div>
            </div>
          </div>

          {stock.dataQuality && stock.dataQuality.missingSources.length > 0 && (
            <div className="border-t border-ink-100 px-4 py-2 bg-amber-50">
              <div className="flex items-center gap-2">
                <AlertCircle size={14} className="text-amber-500 shrink-0" />
                <span className="text-xs text-amber-700">
                  数据缺失: {stock.dataQuality.missingSources.join('、')} — 评分可能不准确
                </span>
              </div>
            </div>
          )}

          <div className="border-t border-ink-100 px-4 py-3 flex justify-end">
            <button
              onClick={(e) => { e.stopPropagation(); onSelect(stock.code); }}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors"
            >
              <BarChart3 size={12} />
              深度分析
            </button>
          </div>
        </div>
      )}
    </div>
  );
}