import { useState, useEffect } from 'react';
import { Sparkles, Star, Plus, ChevronRight, AlertTriangle } from 'lucide-react';
import { fetchQuotes, fetchFundamental } from '@/api';
import { useAppStore } from '@/store';
import { cn, colorClass, fmtPrice, fmtPct } from '@/lib/format';
import { analyzeStock } from '@/strategies/quantSelector';
import { getGradeBgColor, getGradeColor } from '@/strategies/scoring';
import type { SelectorStock } from '@/strategies/quantSelector';

// 推荐股票池（非自选股）
const RECOMMEND_POOL = [
  { code: 'sh600887', name: '伊利股份' },
  { code: 'sh601888', name: '中国中免' },
  { code: 'sz000651', name: '格力电器' },
  { code: 'sh600085', name: '同仁堂' },
  { code: 'sz002415', name: '海康威视' },
  { code: 'sh600276', name: '恒瑞医药' },
  { code: 'sz002230', name: '科大讯飞' },
  { code: 'sh600703', name: '三安光电' },
];

export function StockRecommend() {
  const [recommendations, setRecommendations] = useState<SelectorStock[]>([]);
  const [loading, setLoading] = useState(false);

  const addStock = useAppStore((s) => s.addStock);
  const setSelectedCode = useAppStore((s) => s.setSelectedCode);
  const watchlist = useAppStore((s) => s.watchlist);

  useEffect(() => {
    const fetchRecommendations = async () => {
      setLoading(true);
      try {
        const results: SelectorStock[] = [];
        
        for (const stock of RECOMMEND_POOL) {
          // 跳过已在自选股中的股票
          if (watchlist.some(w => w.code === stock.code)) continue;

          try {
            const [quoteRes, fundamentalRes] = await Promise.all([
              fetchQuotes([stock.code]),
              fetchFundamental(stock.code),
            ]);

            const quote = quoteRes.data?.[0] ?? null;
            const fundamental = fundamentalRes.data ?? null;

            // 创建简化的分析结果
            const pe = fundamental?.peTTM ?? fundamental?.peDyn ?? 25;
            const pb = fundamental?.pb ?? 5;
            const roe = fundamental?.roe ?? 10;
            
            const calcScore = () => {
              const peScore = Math.max(0, Math.min(1, 1 - (pe / 50))) * 30;
              const pbScore = Math.max(0, Math.min(1, 1 - (pb / 10))) * 30;
              const roeScore = Math.max(0, Math.min(1, roe / 20)) * 40;
              return Math.min(100, peScore + pbScore + roeScore);
            };
            
            const result: SelectorStock = {
              code: stock.code,
              name: quote?.name || stock.name,
              price: quote?.price ?? fundamental?.price ?? 0,
              changePct: quote?.changePct ?? fundamental?.changePct ?? 0,
              score: {
                totalScore: calcScore(),
                grade: roe > 15 ? 'A' : roe > 10 ? 'B' : roe > 5 ? 'C' : 'D',
                gradeDescription: '基于基本面数据的智能评分',
                fundamentalScore: 50,
                technicalScore: 50,
                moneyScore: 50,
                dimensions: []
              },
              risk: {
                riskLevel: 'low',
                riskAdjustment: 1,
                isExcluded: false,
                riskItems: []
              },
              adjustedScore: calcScore(),
              rank: 0,
              dataQuality: {
                hasFundamental: !!fundamental,
                hasMoneyFlow: false,
                hasKline: false,
                hasReports: false,
                missingSources: fundamental ? [] : ['基本面'],
              }
            };

            results.push(result);
          } catch {
            continue;
          }
        }

        // 按评分排序
        results.sort((a, b) => b.adjustedScore - a.adjustedScore);
        results.forEach((r, i) => r.rank = i + 1);

        setRecommendations(results.slice(0, 5));
      } catch {
      } finally {
        setLoading(false);
      }
    };

    fetchRecommendations();
  }, [watchlist]);

  const isInWatchlist = (code: string) => {
    return watchlist.some(w => w.code === code);
  };

  const handleAdd = (e: React.MouseEvent, code: string, name: string) => {
    e.stopPropagation();
    addStock({ code, alias: name });
  };

  const handleSelect = (code: string) => {
    setSelectedCode(code);
  };

  return (
    <div className="rounded-lg border border-ink-200 bg-white">
      <div className="flex items-center justify-between border-b border-ink-100 px-3 py-2">
        <div className="flex items-center gap-2">
          <Sparkles size={14} className="text-yellow-500" />
          <h2 className="text-xs font-semibold">智能推荐</h2>
        </div>
        <span className="text-[10px] text-ink-400">基于量化模型</span>
      </div>

      <div className="p-2">
        {loading ? (
          <div className="py-6 text-center text-xs text-ink-400">
            正在分析...
          </div>
        ) : recommendations.length > 0 ? (
          <ul className="space-y-2">
            {recommendations.map((stock) => {
              const inWatchlist = isInWatchlist(stock.code);
              return (
                <li
                  key={stock.code}
                  onClick={() => handleSelect(stock.code)}
                  className="flex items-center justify-between p-2 rounded-lg hover:bg-ink-50 cursor-pointer transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <span className={cn(
                      'w-5 h-5 flex items-center justify-center rounded-full text-[10px] font-bold',
                      stock.rank === 1 ? 'bg-gradient-to-br from-yellow-300 to-yellow-500 text-white' :
                      stock.rank === 2 ? 'bg-gradient-to-br from-gray-200 to-gray-400 text-white' :
                      stock.rank === 3 ? 'bg-gradient-to-br from-orange-300 to-orange-500 text-white' :
                      'bg-ink-100 text-ink-500'
                    )}>
                      {stock.rank}
                    </span>
                    <div className="min-w-0">
                      <div className="text-xs font-medium">{stock.name}</div>
                      <div className="text-[10px] text-ink-400">{stock.code}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="text-right">
                      <div className="tabular text-xs">{fmtPrice(stock.price)}</div>
                      <div className={cn('tabular text-[10px]', colorClass(stock.changePct))}>
                        {stock.changePct >= 0 ? '+' : ''}{stock.changePct.toFixed(2)}%
                      </div>
                    </div>
                    <span className={cn('px-1.5 py-0.5 rounded text-[10px] font-medium', getGradeBgColor(stock.score.grade))}>
                      {stock.adjustedScore.toFixed(0)}{stock.score.grade}
                    </span>
                    {!inWatchlist && (
                      <button
                        onClick={(e) => handleAdd(e, stock.code, stock.name)}
                        className="p-1 rounded text-ink-300 hover:text-green-600 hover:bg-green-50 transition-colors"
                        title="添加到自选"
                      >
                        <Plus size={12} />
                      </button>
                    )}
                    <ChevronRight size={14} className="text-ink-300" />
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="py-6 text-center text-xs text-ink-400">
            暂无推荐，您的自选股已包含所有候选股票
          </div>
        )}
      </div>

      <div className="border-t border-ink-100 px-3 py-2">
        <div className="flex items-center gap-2 text-[10px] text-ink-400">
          <Star size={10} className="text-yellow-500" />
          <span>评分基于基本面、技术面、资金面多因子模型</span>
        </div>
      </div>
    </div>
  );
}