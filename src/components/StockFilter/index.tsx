import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { TrendingUp, RefreshCw, Download, Info, Activity, Loader2, Zap, Clock } from 'lucide-react';
import { useAppStore } from '@/store';
import { cn } from '@/lib/format';
import { StrategySelector, STRATEGIES, type StrategyConfig } from './StrategySelector';
import { FilterPanel, type FilterOptions } from './FilterPanel';
import { StatsPanel } from './StatsPanel';
import { StockCard } from './StockCard';
import { fetchAllStocks, fetchQuotes, fetchFundamental, fetchMoneyFlow, fetchFinReport, fetchKline } from '@/api';
import { analyzeStock, type SelectorStock } from '@/strategies/quantSelector';
import { isTradingTime } from '@/lib/marketTime';
import type { Quote, Fundamental, MoneyFlow, FinReport, KlineBar } from '@/types';

// ── 类型 ────────────────────────────────────────────────
interface StockBasicInfo {
  code: string;
  name: string;
  price: number;
  changePct: number;
  turnover: number;
  marketCap: number;
}

type AnalysisPhase = 'idle' | 'fetching_list' | 'pre_filtering' | 'analyzing' | 'done';

// ── 常量 ────────────────────────────────────────────────
const BATCH_SIZE = 15;        // 每批并发请求数
const MAX_CANDIDATES = 300;   // 量化分析最多分析的候选股数
const PRE_FILTER_MIN_TURNOVER = 0.5;  // 预筛选最小换手率

// ── 组件 ────────────────────────────────────────────────
export function StockSelectorPage() {
  const setSelectedCode = useAppStore((s) => s.setSelectedCode);
  const watchlist = useAppStore((s) => s.watchlist);
  const setStrategyWeights = useAppStore((s) => s.setStrategyWeights);
  const abortRef = useRef<AbortController | null>(null);

  // ── 状态 ──────────────────────────────────────────────
  const [selectedStrategy, setSelectedStrategy] = useState<StrategyConfig>(STRATEGIES[1]);
  const [customWeights, setCustomWeights] = useState({ fundamental: 35, technical: 35, money: 30 });

  // 策略切换时同步到 store
  const handleStrategyChange = (strategy: StrategyConfig) => {
    setSelectedStrategy(strategy);
    setCustomWeights(strategy.weights);
    setStrategyWeights(strategy.weights);
  };

  const handleWeightsChange = (weights: { fundamental: number; technical: number; money: number }) => {
    setCustomWeights(weights);
    setStrategyWeights(weights);
  };

  const [filterOptions, setFilterOptions] = useState<FilterOptions>({
    scope: 'market',
    selectedIndustry: '',
    selectedConcept: '',
    selectedIndex: '',
    minScore: 0,
    riskLevels: ['low', 'medium', 'high'],
    marketCap: 'all',
    minAmount: 0,
    filterExtreme: false,
    sortBy: 'adjusted',
  });

  const [allStockList, setAllStockList] = useState<StockBasicInfo[]>([]);
  const [analyzedStocks, setAnalyzedStocks] = useState<SelectorStock[]>([]);
  const [phase, setPhase] = useState<AnalysisPhase>('idle');
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  // ── 预筛选：根据基本条件快速过滤 ──────────────────────
  const preFilterStocks = useCallback((list: StockBasicInfo[]): StockBasicInfo[] => {
    let result = [...list];

    // 排除科创板(688)和创业板(300/301)
    result = result.filter(s => {
      const num = s.code.slice(2);
      return !num.startsWith('688') && !num.startsWith('300') && !num.startsWith('301');
    });

    // 市值筛选
    if (filterOptions.marketCap !== 'all') {
      const capMap: Record<string, [number, number]> = {
        small: [0, 50e8],
        medium: [50e8, 200e8],
        large: [200e8, 1000e8],
        xlarge: [1000e8, Infinity],
      };
      const [min, max] = capMap[filterOptions.marketCap];
      result = result.filter(s => s.marketCap >= min && s.marketCap < max);
    }

    // 换手率筛选（流动性）
    result = result.filter(s => s.turnover >= PRE_FILTER_MIN_TURNOVER && s.price > 0);

    // 过滤异常涨跌
    if (filterOptions.filterExtreme) {
      result = result.filter(s => Math.abs(s.changePct) <= 10);
    }

    // 按当日涨跌幅排序取前MAX_CANDIDATES进入量化分析
    return result.slice(0, MAX_CANDIDATES);
  }, [filterOptions.marketCap, filterOptions.filterExtreme]);

  // ── 单只股票深度分析 ──────────────────────────────────
  const analyzeOne = async (stock: StockBasicInfo): Promise<SelectorStock> => {
    try {
      const [quoteResult, fundamentalResult, moneyFlowResult, reportsResult, klineResult] = await Promise.all([
        fetchQuotes([stock.code]).then(res => res.data[0] || null).catch(() => null),
        fetchFundamental(stock.code).then(res => res.data).catch(() => null),
        fetchMoneyFlow(stock.code).then(res => res.data).catch(() => null),
        fetchFinReport(stock.code).then(res => res.data).catch(() => []),
        fetchKline(stock.code, 60).then(res => res.data).catch(() => []),
      ]);

      return analyzeStock(stock.code, stock.name, quoteResult, fundamentalResult, moneyFlowResult, reportsResult, klineResult, customWeights);
    } catch {
      // 单只失败不影响整体
      return analyzeStock(stock.code, stock.name, null, null, null, [], [], customWeights);
    }
  };

  // ── 分批分析 ──────────────────────────────────────────
  const batchAnalyze = async (candidates: StockBasicInfo[], signal?: AbortSignal) => {
    const results: SelectorStock[] = [];
    const total = candidates.length;

    for (let i = 0; i < total; i += BATCH_SIZE) {
      if (signal?.aborted) break;

      const batch = candidates.slice(i, i + BATCH_SIZE);
      const batchResults = await Promise.all(batch.map(analyzeOne));
      results.push(...batchResults);

      setProgress({ current: Math.min(i + BATCH_SIZE, total), total });
    }

    return results;
  };

  // ── 主流程：获取全量 → 预筛选 → 量化分析 → 排序 ──────
  const runFullAnalysis = useCallback(async () => {
    // 取消之前的请求
    if (abortRef.current) {
      abortRef.current.abort();
    }
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      setError(null);
      setPhase('fetching_list');
      setProgress({ current: 0, total: 0 });

      // 1. 获取全量 A 股列表
      const { data: stockList } = await fetchAllStocks();
      if (controller.signal.aborted) return;

      setAllStockList(stockList);
      setPhase('pre_filtering');

      // 2. 预筛选
      const candidates = preFilterStocks(stockList);
      if (controller.signal.aborted) return;

      setPhase('analyzing');
      setProgress({ current: 0, total: candidates.length });

      // 3. 分批量化分析
      const results = await batchAnalyze(candidates, controller.signal);
      if (controller.signal.aborted) return;

      // 4. 排序
      results.sort((a, b) => b.adjustedScore - a.adjustedScore);
      results.forEach((stock, index) => {
        stock.rank = index + 1;
      });

      setAnalyzedStocks(results);
      setPhase('done');
      setUpdatedAt(Date.now());
    } catch (e: any) {
      if (e?.name === 'AbortError') return;
      setError(e?.message || '分析失败');
      setPhase('idle');
    }
  }, [preFilterStocks]);

  // 首次加载 & 自选股范围变化时触发
  useEffect(() => {
    runFullAnalysis();
  }, [runFullAnalysis]);

  // ── 前端二次筛选 ──────────────────────────────────────
  const filteredStocks = useMemo(() => {
    let result = [...analyzedStocks];

    result = result.filter(stock => {
      if (stock.adjustedScore < filterOptions.minScore) return false;
      if (!filterOptions.riskLevels.includes(stock.risk.riskLevel)) return false;
      if (filterOptions.filterExtreme && Math.abs(stock.changePct) > 10) return false;
      return true;
    });

    result.sort((a, b) => {
      switch (filterOptions.sortBy) {
        case 'fundamental': return b.score.fundamentalScore - a.score.fundamentalScore;
        case 'technical': return b.score.technicalScore - a.score.technicalScore;
        case 'money': return b.score.moneyScore - a.score.moneyScore;
        case 'change': return b.changePct - a.changePct;
        case 'turnover': return (b.price * 100) - (a.price * 100);
        default: return b.adjustedScore - a.adjustedScore;
      }
    });

    result.forEach((stock, index) => {
      stock.rank = index + 1;
    });

    return result;
  }, [analyzedStocks, filterOptions]);

  // ── 导出CSV ───────────────────────────────────────────
  const handleExport = () => {
    const data = filteredStocks.map(s => ({
      rank: s.rank, name: s.name, code: s.code, price: s.price, changePct: s.changePct,
      score: s.score.totalScore, adjustedScore: s.adjustedScore, grade: s.score.grade,
      riskLevel: s.risk.riskLevel,
      fundamentalScore: s.score.fundamentalScore, technicalScore: s.score.technicalScore, moneyScore: s.score.moneyScore,
    }));
    const csv = [
      ['排名', '股票名称', '代码', '价格', '涨跌幅', '综合评分', '风险调整后', '评级', '风险等级', '基本面', '技术面', '资金面'].join(','),
      ...data.map(d => [
        d.rank, `"${d.name}"`, d.code, d.price.toFixed(2),
        `${d.changePct >= 0 ? '+' : ''}${d.changePct.toFixed(2)}%`,
        d.score.toFixed(1), d.adjustedScore.toFixed(1), d.grade,
        d.riskLevel === 'high' ? '高' : d.riskLevel === 'medium' ? '中' : '低',
        d.fundamentalScore.toFixed(1), d.technicalScore.toFixed(1), d.moneyScore.toFixed(1),
      ].join(','))
    ].join('\n');
    const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `stock-selector-${Date.now()}.csv`;
    link.click();
  };

  // ── 进度提示文本 ──────────────────────────────────────
  const phaseText: Record<AnalysisPhase, string> = {
    idle: '准备中...',
    fetching_list: '正在获取全量 A 股列表...',
    pre_filtering: '正在预筛选候选股...',
    analyzing: `正在量化分析 (${progress.current}/${progress.total})...`,
    done: '分析完成',
  };

  const isRunning = phase !== 'idle' && phase !== 'done';

  // ── 渲染 ──────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-ink-50 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* 头部 */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-gradient-to-br from-red-500 to-orange-500">
              <TrendingUp size={20} className="text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-ink-900">详细选股</h1>
              <p className="text-xs text-ink-400">
                全量{allStockList.length.toLocaleString()}只A股实时量化筛选
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {isRunning && (
              <span className="flex items-center gap-1.5 text-sm text-blue-600">
                <Loader2 size={14} className="animate-spin" />
                {phaseText[phase]}
              </span>
            )}
            {!isRunning && (
              <span className="text-sm text-ink-400">
                共 {filteredStocks.length} 只 · 更新于 {updatedAt ? new Date(updatedAt).toLocaleTimeString() : '--'}
              </span>
            )}
            <button
              onClick={runFullAnalysis}
              disabled={isRunning}
              className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-ink-900 rounded-lg hover:bg-ink-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <RefreshCw size={14} className={isRunning ? 'animate-spin' : ''} />
              {isRunning ? '分析中' : '刷新'}
            </button>
          </div>
        </div>

        {/* 交易时段提示 */}
        <div className={cn(
          'flex items-center gap-2 px-4 py-2 rounded-lg text-sm',
          isTradingTime() 
            ? 'bg-green-50 border border-green-200 text-green-700'
            : 'bg-gray-50 border border-gray-200 text-gray-600'
        )}>
          <Clock size={14} />
          <span>
            {isTradingTime() 
              ? '交易时段 — 数据实时更新中（3分钟刷新）'
              : '非交易时段 — 数据将延迟更新（盘前/盘后 10分钟，其他 30分钟）'
            }
          </span>
        </div>

        {/* 错误提示 */}
        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {error}
            <button onClick={runFullAnalysis} className="ml-4 underline">重试</button>
          </div>
        )}

        {/* 进度条 */}
        {isRunning && phase === 'analyzing' && (
          <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-blue-700 flex items-center gap-2">
                <Zap size={14} />
                量化分析中 — 从全量 {allStockList.length.toLocaleString()} 只A股中筛选
              </span>
              <span className="text-sm text-blue-500">{progress.current}/{progress.total}</span>
            </div>
            <div className="h-2 bg-blue-200 rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-500 rounded-full transition-all duration-300"
                style={{ width: `${progress.total > 0 ? (progress.current / progress.total) * 100 : 0}%` }}
              />
            </div>
          </div>
        )}

        <div className="grid grid-cols-4 gap-6">
          {/* 左侧面板 */}
          <div className="col-span-1 space-y-4">
            <StrategySelector
              selectedStrategy={selectedStrategy}
              onSelect={handleStrategyChange}
              customWeights={customWeights}
              onCustomWeightsChange={handleWeightsChange}
            />
            <FilterPanel
              options={filterOptions}
              watchlistCount={watchlist.length}
              onOptionsChange={setFilterOptions}
            />
          </div>

          {/* 右侧主区 */}
          <div className="col-span-3 space-y-4">
            <StatsPanel stocks={filteredStocks} loading={isRunning} />

            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-ink-700">
                选股结果
                {!isRunning && (
                  <span className="ml-2 text-xs text-ink-400">
                    (从 {allStockList.length.toLocaleString()} 只全量A股中筛选)
                  </span>
                )}
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleExport}
                  disabled={filteredStocks.length === 0}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-ink-600 bg-white border border-ink-200 rounded-lg hover:bg-ink-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  <Download size={14} />
                  导出 CSV
                </button>
              </div>
            </div>

            {isRunning ? (
              <div className="rounded-lg border border-ink-200 bg-white p-8 text-center">
                <Loader2 size={48} className="mx-auto text-blue-400 animate-spin mb-3" />
                <p className="text-sm text-ink-500">{phaseText[phase]}</p>
                <p className="text-xs text-ink-400 mt-1">请耐心等待，首次分析需要约30-60秒</p>
              </div>
            ) : filteredStocks.length === 0 ? (
              <div className="rounded-lg border border-ink-200 bg-white p-8 text-center">
                <Activity size={48} className="mx-auto text-ink-300 mb-3" />
                <p className="text-sm text-ink-500">暂无符合条件的股票</p>
                <p className="text-xs text-ink-400 mt-1">请调整筛选条件后重试</p>
              </div>
            ) : (
              <div className="space-y-3">
                {filteredStocks.slice(0, 100).map((stock) => (
                  <StockCard key={stock.code} stock={stock} onSelect={setSelectedCode} />
                ))}
                {filteredStocks.length > 100 && (
                  <p className="text-center text-xs text-ink-400 py-2">
                    仅显示前 100 只，共 {filteredStocks.length} 只匹配
                  </p>
                )}
              </div>
            )}

            {/* 使用说明 */}
            <div className="rounded-lg border border-ink-200 bg-white p-4">
              <div className="flex items-center gap-2 mb-3">
                <Info size={14} className="text-ink-400" />
                <span className="text-sm font-semibold text-ink-900">使用说明</span>
              </div>
              <div className="grid grid-cols-4 gap-4 text-xs text-ink-500">
                <div>
                  <p className="font-medium text-ink-700 mb-1">全量数据</p>
                  <p>从东方财富实时获取5000+只A股，每5分钟缓存更新</p>
                </div>
                <div>
                  <p className="font-medium text-ink-700 mb-1">智能预筛选</p>
                  <p>先按换手率、市值等快速过滤，再对Top300量化分析</p>
                </div>
                <div>
                  <p className="font-medium text-ink-700 mb-1">评分体系</p>
                  <p>S级(85+)、A级(70-84)、B级(55-69)、C级(40-54)、D级(&lt;40)</p>
                </div>
                <div>
                  <p className="font-medium text-ink-700 mb-1">风险过滤</p>
                  <p>自动识别ST、停牌、流动性不足等高风险股票</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}