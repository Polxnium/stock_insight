/**
 * StockAnalysis — 个股多维分析面板
 *
 * 布局：
 *   ┌─ 行情主卡（价格/涨跌/四格指标）─────────────────┐
 *   ├─ 2x2 数据卡片网格 ─────────────────────────────┤
 *   │  [近期公告]   [基本面]                           │
 *   │  [技术面]     [资金面]                           │
 *   └─ AI 分析结果区（流式输出 → 结构化卡片）──────────┘
 *
 * 数据流：
 *   - 行情：usePolling 5s/60s（自适应）
 *   - 基本面：usePolling 60s/300s
 *   - 资金流：usePolling 10s/120s
 *   - K线：usePolling 5min/30min（日K变化慢，无需频繁刷新）
 *   - 公告：usePolling 10min/30min
 *   - AI 分析：点击按钮触发，流式输出，支持中途停止
 */

import { useMemo, useRef, useState, useEffect } from 'react';
import { RefreshCw, Sparkles, Wallet, LineChart, Square, X, Loader2, ArrowUpRight, ArrowDownRight } from 'lucide-react';
import { useAppStore } from '@/store';
import { LLM_MODELS } from '@/config/llm';
import {
  chatLLM,
  chatLLMStream,
  fetchAnnouncements,
  fetchFundamental,
  fetchKline,
  fetchFinReport,
  fetchMFKline,
  fetchMoneyFlow,
  fetchNews,
  fetchQuotes,
} from '@/api';
import { usePolling } from '@/hooks/usePolling';
import { adaptiveInterval } from '@/lib/marketTime';
import { buildAnalysisPrompt, buildFixupPrompt, parseAnalysisJSON } from '@/lib/analysisPrompt';
import { summarizeTechnicals } from '@/lib/indicators';
import { pickRelatedNews } from '@/lib/newsMatch';
import { cn, colorClass, fmtAmount, fmtPct, fmtPrice } from '@/lib/format';
import { FreshBadge } from './FreshBadge';
import type { AnalysisResult, FinReport, KlineBar, MFKlineBar, MoneyFlow } from '@/types';

// ============================================================
// 主组件
// ============================================================

export function StockAnalysis() {
  const selectedCode = useAppStore((s) => s.selectedCode);
  const modelId      = useAppStore((s) => s.modelId);
  const modelCfg     = useMemo(() => LLM_MODELS.find((m) => m.id === modelId)!, [modelId]);

  // ── 多源数据轮询 ──────────────────────────────────────
  // 增加 loading 状态解构
  const quoteQ = usePolling(
    () => selectedCode
      ? fetchQuotes([selectedCode])
      : Promise.resolve({ data: [], ts: Date.now() }),
    () => adaptiveInterval(5_000, 60_000),
    [selectedCode],
  );
  const quote = quoteQ.data?.data?.[0] ?? null;
  const quoteLoading = quoteQ.loading;

  const fundQ = usePolling(
    () => selectedCode
      ? fetchFundamental(selectedCode)
      : Promise.resolve({ data: null as never, ts: Date.now() }),
    () => adaptiveInterval(60_000, 300_000),
    [selectedCode],
  );
  const fundamental = fundQ.data?.data ?? null;
  const fundLoading = fundQ.loading;

  const mfQ = usePolling(
    () => selectedCode
      ? fetchMoneyFlow(selectedCode)
      : Promise.resolve({ data: null as never, ts: Date.now() }),
    // 资金流实时性强：盘中 5s 刷新，盘后 60s（服务端无缓存，每次实时查询）
    () => adaptiveInterval(5_000, 60_000),
    [selectedCode],
  );
  const moneyflow = mfQ.data?.data ?? null;
  const mfLoading = mfQ.loading;

  const mfkQ = usePolling(
    () => selectedCode
      ? fetchMFKline(selectedCode, 20)
      : Promise.resolve({ data: [] as MFKlineBar[], ts: Date.now() }),
    () => adaptiveInterval(5 * 60_000, 30 * 60_000),
    [selectedCode],
  );
  const mfklines = mfkQ.data?.data ?? [];
  const mfkLoading = mfkQ.loading;

  const klineQ = usePolling(
    () => selectedCode
      ? fetchKline(selectedCode, 30)
      : Promise.resolve({ data: [], ts: Date.now() }),
    // 日K每分钟才新增一个点，5分钟刷新已经足够
    () => adaptiveInterval(5 * 60_000, 30 * 60_000),
    [selectedCode],
  );
  const klines = klineQ.data?.data ?? [];
  const finrQ = usePolling(
    () => selectedCode
      ? fetchFinReport(selectedCode)
      : Promise.resolve({ data: [] as FinReport[], ts: Date.now() }),
    // 财报每季度才更新，30min 刷一次足够
    () => adaptiveInterval(30 * 60_000, 60 * 60_000),
    [selectedCode],
  );
  const finReports = finrQ.data?.data ?? [];

  // 技术面文字摘要（由 K线数据派生，K线变才重算）
  const technicalText = useMemo(
    () => (klines.length >= 10 ? summarizeTechnicals(klines) : null),
    [klines],
  );

  // ── AI 分析状态 ───────────────────────────────────────
  const [showModal, setShowModal] = useState(false);
  const [result,    setResult]    = useState<AnalysisResult | null>(null);
  const [streaming, setStreaming] = useState('');
  const [loading,   setLoading]   = useState(false);
  const [error,     setError]     = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  async function handleAnalyze() {
    if (!quote) return;
    
    // 打开弹窗并重置状态
    setShowModal(true);
    setLoading(true);
    setError(null);
    setResult(null);
    setStreaming('');

    const ac = new AbortController();
    abortRef.current = ac;

    // 设置总体超时保护（2分钟）
    const timeoutId = setTimeout(() => {
      ac.abort();
      setError('分析超时，请重试或选择更快的模型');
      setLoading(false);
    }, 120000);

    try {
      // 拉最新新闻并智能筛选与本股相关的条目
      const newsResp   = await fetchNews(50);
      const relatedNews = pickRelatedNews(newsResp.data, {
        name:  quote.name,
        code:  quote.code,
        limit: 10,
      });

      const messages = buildAnalysisPrompt({
        quote,
        fundamental,
        moneyflow,
        klines,
        announcements: [],
        relatedNews: relatedNews,
      });

      // 流式输出：实时回显给用户
      const full = await chatLLMStream(
        { provider: modelCfg.provider, model: modelCfg.model, messages, temperature: 0.3, signal: ac.signal },
        (_delta, fullText) => setStreaming(fullText),
      );

      // 解析 JSON；失败则让模型自我修复一次（B2 策略）
      // 注意：不清除 streaming 状态，作为降级显示的备用
      try {
        const parsed = parseAnalysisJSON(full);
        setResult(parsed);
      } catch {
        try {
          const fixed = await chatLLM({
            provider: modelCfg.provider,
            model:    modelCfg.model,
            messages: buildFixupPrompt(full),
            temperature: 0.1,
          });
          const parsed = parseAnalysisJSON(fixed);
          setResult(parsed);
        } catch {
          // 两次解析均失败：降级展示原文（保留 streaming 内容）
          setResult({ conclusion: '', bullish: [], bearish: [], risks: [], suggestion: '', raw: full });
        }
      }
    } catch (e) {
      if ((e as { name?: string }).name !== 'AbortError') {
        const errMsg = e instanceof Error ? e.message : String(e);
        setError(errMsg);
      }
    } finally {
      clearTimeout(timeoutId);
      setLoading(false);
      abortRef.current = null;
    }
  }

  function handleStop() {
    abortRef.current?.abort();
    setLoading(false);
  }

  function handleCloseModal() {
    if (loading) {
      // 如果正在分析中，先停止
      handleStop();
    }
    setShowModal(false);
  }

  // ── 未选中状态 ────────────────────────────────────────
  if (!selectedCode) {
    return (
      <div className="flex h-full min-h-[300px] items-center justify-center rounded-lg border border-dashed border-ink-200 bg-white text-sm text-ink-400">
        ← 从左侧选择一只股票开始分析
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* ── 行情主卡 ──────────────────────────────────── */}
      <QuoteCard
        quote={quote}
        code={selectedCode}
        klines={klines}
        fundamental={fundamental}
        updatedAt={quoteQ.updatedAt}
        loading={quoteQ.loading && !quote}
        modelLabel={modelCfg.label}
        analyzing={loading}
        onAnalyze={handleAnalyze}
        onStop={handleStop}
      />

      {/* ── 资金流向速览 ────────────────────────────── */}

      {/* ── 数据维度：上行 技术面(1/2) + 资金面(1/2)，下行 基本面 ── */}
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <TechnicalCard text={technicalText} bars={klines} ts={klineQ.updatedAt} loading={klineQ.loading && !klines.length} />
          <MoneyFlowCard
            data={moneyflow}   ts={mfQ.updatedAt}   loading={mfQ.loading && !moneyflow}
            mfklines={mfklines} mfkLoading={mfkQ.loading && !mfklines.length}
            error={mfQ.error}
          />
        </div>
        <FundamentalCard data={fundamental} ts={fundQ.updatedAt} loading={fundQ.loading && !fundamental} error={fundQ.error} reports={finReports} reportsLoading={finrQ.loading && !finReports.length} />
      </div>

      {/* ── AI 分析弹窗 ───────────────────────────────── */}
      {showModal && (
        <AnalysisModal
          stockName={quote?.name}
          modelLabel={modelCfg.label}
          result={result}
          streaming={streaming}
          loading={loading}
          error={error}
          onClose={handleCloseModal}
          onStop={handleStop}
        />
      )}
    </div>
  );
}

// ============================================================
// 子组件：资金流向速览
// ============================================================

function MoneyFlowIndicator({ data, loading }: { data: MoneyFlow | null; loading: boolean }) {
  const fmtMoney = (val: number | null) => {
    if (val == null || !Number.isFinite(val)) return '—';
    const abs = Math.abs(val);
    if (abs >= 1e8) return `${(val / 1e8).toFixed(2)}亿`;
    if (abs >= 1e4) return `${(val / 1e4).toFixed(2)}万`;
    return val.toFixed(0);
  };
  const fmtPct = (val: number | null) => {
    if (val == null || !Number.isFinite(val)) return '—';
    return `${val >= 0 ? '+' : ''}${val.toFixed(2)}%`;
  };

  const colorClassFn = (val: number | null) => {
    if (val == null || !Number.isFinite(val)) return 'text-ink-500';
    return val > 0 ? 'text-up' : val < 0 ? 'text-down' : 'text-ink-500';
  };

  const arrow = (val: number | null) => {
    if (val == null || !Number.isFinite(val)) return '→';
    return val > 0 ? '↗' : val < 0 ? '↘' : '→';
  };

  // 加载中且无数据：显示骨架屏
  if (loading && !data) {
    return (
      <div className="flex h-10 items-center gap-3 rounded-lg border border-ink-200 bg-white px-4 py-2.5">
        <div className="h-3 w-28 animate-pulse rounded bg-ink-100" />
        <div className="h-4 w-px bg-ink-200" />
        <div className="h-3 w-24 animate-pulse rounded bg-ink-100" />
        <div className="h-4 w-px bg-ink-200" />
        <div className="h-3 w-20 animate-pulse rounded bg-ink-100" />
        <div className="h-4 w-px bg-ink-200" />
        <div className="h-3 w-20 animate-pulse rounded bg-ink-100" />
        <div className="h-4 w-px bg-ink-200" />
        <div className="h-3 w-20 animate-pulse rounded bg-ink-100" />
      </div>
    );
  }

  // 无数据（API 返回空或只返回了 null）
  if (!data) {
    return (
      <div className="flex h-10 items-center gap-3 rounded-lg border border-ink-200 bg-white px-4 py-2.5 text-sm">
        <span className="text-xs text-ink-400">暂无资金流数据（接口波动，稍后重试）</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 rounded-lg border border-ink-200 bg-white px-4 py-2.5 text-sm">
      {/* 主力资金 */}
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-ink-500">主力</span>
        <span className={cn('tabular font-semibold', colorClassFn(data.mainNet))}>
          {fmtMoney(data.mainNet)}
        </span>
        <span className={cn('tabular text-xs', colorClassFn(data.mainPct))}>
          ({fmtPct(data.mainPct)})
        </span>
      </div>

      {/* 分隔线 */}
      <div className="h-4 w-px bg-ink-200" />

      {/* 超大单 */}
      <div className="flex items-center gap-1.5">
        <span className="text-[11px] text-ink-400">超大单</span>
        <span className={cn('tabular text-xs font-medium', colorClassFn(data.superLargeNet))}>
          {fmtMoney(data.superLargeNet)}
        </span>
      </div>

      {/* 分隔线 */}
      <div className="h-4 w-px bg-ink-200" />

      {/* 大单 */}
      <div className="flex items-center gap-1.5">
        <span className="text-[11px] text-ink-400">大单</span>
        <span className={cn('tabular text-xs font-medium', colorClassFn(data.largeNet))}>
          {fmtMoney(data.largeNet)}
        </span>
      </div>

      {/* 分隔线 */}
      <div className="h-4 w-px bg-ink-200" />

      {/* 中单 */}
      <div className="flex items-center gap-1.5">
        <span className="text-[11px] text-ink-400">中单</span>
        <span className={cn('tabular text-xs font-medium', colorClassFn(data.mediumNet))}>
          {fmtMoney(data.mediumNet)}
        </span>
      </div>

      {/* 分隔线 */}
      <div className="h-4 w-px bg-ink-200" />

      {/* 小单 */}
      <div className="flex items-center gap-1.5">
        <span className="text-[11px] text-ink-400">小单</span>
        <span className={cn('tabular text-xs font-medium', colorClassFn(data.smallNet))}>
          {fmtMoney(data.smallNet)}
        </span>
      </div>
    </div>
  );
}


// ============================================================
// 子组件：行情主卡
// ============================================================

interface QuoteCardProps {
  quote:       any;
  code:        string;
  klines:      KlineBar[];
  fundamental: any;
  updatedAt:   number | null;
  loading:     boolean;
  modelLabel:  string;
  analyzing:   boolean;
  onAnalyze:   () => void;
  onStop:      () => void;
}

function QuoteCard({ quote, code, klines, fundamental, updatedAt, loading, modelLabel, analyzing, onAnalyze, onStop }: QuoteCardProps) {
  // ── 昨日行情：从 K 线找最近完结的交易日 ──────────────────────
  const todayDate = quote?.date ?? '';
  const lastBar   = klines[klines.length - 1] ?? null;
  // 如果最后一根 K 线是今天的（盘中实时更新），取前一根作为昨日
  const prevBar = lastBar
    ? (lastBar.date === todayDate && klines.length >= 2
        ? klines[klines.length - 2]
        : lastBar)
    : null;
  // 由昨日涨跌幅反推昨日基准价（前日收盘）
  const ydayPrevClose = prevBar && Number.isFinite(prevBar.changePct)
    ? prevBar.close / (1 + prevBar.changePct / 100)
    : NaN;
  return (
    <div className="rounded-lg border border-ink-200 bg-white">
      <div className="flex items-start justify-between border-b border-ink-100 px-4 py-3">
        <div>
          {/* 股票名称和价格在同一行 */}
          <div className="flex items-baseline gap-2 flex-wrap">
            <h2 className="text-xs font-semibold">{quote?.name || '加载中…'}</h2>
            <span className="text-[10px] text-ink-400">{code.replace(/^(sh|sz)/i, '')}</span>
            {quote && (
              <>
                <span className={cn('tabular text-base font-semibold', colorClass(quote.changePct))}>
                  {fmtPrice(quote.price)}
                </span>
                <span className={cn('tabular text-xs', colorClass(quote.changePct))}>
                  {fmtPct(quote.changePct)} ({quote.change >= 0 ? '+' : ''}{quote.change.toFixed(2)})
                </span>
              </>
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {/* 刷新时间放在右上角 */}
          <FreshBadge ts={updatedAt} loading={loading} className="text-[11px]" />
          <span className="hidden text-[11px] text-ink-400 sm:block">{modelLabel}</span>
          {analyzing && (
            <button
              onClick={onStop}
              className="flex items-center gap-1 rounded border border-ink-200 px-2.5 py-1.5 text-xs text-ink-600 hover:bg-ink-50"
            >
              <Square size={11} /> 停止
            </button>
          )}
          <button
            onClick={onAnalyze}
            disabled={analyzing || !quote}
            className="flex items-center gap-1.5 rounded bg-ink-900 px-2.5 py-1 text-[10px] text-white hover:bg-ink-700 disabled:opacity-50"
          >
            {analyzing
              ? <RefreshCw size={12} className="animate-spin" />
              : <Sparkles size={12} />}
            {analyzing ? '分析中…' : 'AI 多维分析'}
          </button>
        </div>
      </div>

      {/* ── 今日 / 昨日 行情对比 ──────────────────── */}
      {quote && (
        <div className="flex divide-x divide-ink-100 border-t border-ink-100 text-xs tabular">
          <DayPanel
            title="今日"
            open={quote.open}
            close={quote.price}
            high={quote.high}
            low={quote.low}
            prevClose={quote.prevClose}
            changePct={quote.changePct}
            turnover={fundamental?.turnover}
            volumeRatio={fundamental?.volumeRatio}
          />
          <DayPanel
            title="昨日"
            open={prevBar?.open ?? NaN}
            close={prevBar?.close ?? NaN}
            high={prevBar?.high ?? NaN}
            low={prevBar?.low ?? NaN}
            prevClose={ydayPrevClose}
            changePct={prevBar?.changePct ?? NaN}
            turnover={null}
            volumeRatio={null}
          />
        </div>
      )}
    </div>
  );
}

// ============================================================
// 子组件：通用数据卡容器
// ============================================================

function DataCard({
  title, icon, ts, loading, children,
}: {
  title:    string;
  icon:     React.ReactNode;
  ts:       number | null;
  loading?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-full flex-col rounded-lg border border-ink-200 bg-white">
      <div className="flex items-center justify-between border-b border-ink-100 px-3 py-1.5 text-xs">
        <div className="flex items-center gap-1.5 font-medium text-ink-700">{icon} {title}</div>
        <FreshBadge ts={ts} loading={loading} className="text-[11px]" />
      </div>
      <div className="p-3">{children}</div>
    </div>
  );
}

function SkeletonRows({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-1.5">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="h-3 animate-pulse rounded bg-ink-100" />
      ))}
    </div>
  );
}

// ============================================================
// 子组件：基本面卡片
// ============================================================

function FundamentalCard({
  data, ts, loading, error, reports, reportsLoading,
}: {
  data:            any;
  ts:              number | null;
  loading:         boolean;
  error?:          Error | null;
  reports:         FinReport[];
  reportsLoading:  boolean;
}) {
  // 从财报数据中获取最新的 ROE 和 EPS（基本面接口不提供这些数据）
  const latestReport = reports.length > 0 ? reports[0] : null;
  const roe = data?.roe ?? latestReport?.roe ?? null;
  const eps = data?.eps ?? latestReport?.eps ?? null;

  return (
    <DataCard title="基本面" icon={<LineChart size={12} />} ts={ts} loading={loading && !data && !error}>
      {error ? (
        <div className="py-3 text-center">
          <p className="text-[11px] text-down">数据加载失败</p>
          <p className="mt-0.5 break-all text-[10px] text-ink-400">{error.message}</p>
        </div>
      ) : data ? (
        <div className="grid grid-cols-2 gap-3 text-xs tabular">
          {/* 左侧：基本信息 */}
          <div className="space-y-1.5">
            <FundRow k="PE(TTM)"  v={data.peTTM}                    desc={descPE(data.peTTM)} />
            <FundRow k="PB"       v={data.pb}                        desc={descPB(data.pb)} />
            <FundRow k="ROE"      v={roe}           suffix="%"     desc={descROE(roe)} />
            <FundRow k="EPS"      v={eps}                            desc={descEPS(eps)} />
            <FundRow k="换手率"   v={data.turnover}    suffix="%"     desc={descTurnover(data.turnover)} />
            <FundRow k="量比"     v={data.volumeRatio}               desc={descVolumeRatio(data.volumeRatio)} />
            <FundRow k="总市值"   v={data.totalMarketCap} format="yi" desc={descMarketCap(data.totalMarketCap)} />
            <FundRow k="流通市值" v={data.floatMarketCap}  format="yi" desc={descMarketCap(data.floatMarketCap)} />
          </div>
          {/* 右侧：近期业绩报告 */}
          <div className="border-l border-ink-100 pl-3">
            {(reports.length > 0 || reportsLoading) ? (
              <>
                <div className="mb-1.5 text-[10px] font-semibold tracking-wide text-ink-400">近期业绩报告</div>
                {reportsLoading ? (
                  <SkeletonRows rows={2} />
                ) : (
                  (() => {
                    const maxRevenue = Math.max(...reports.map(r => Math.abs(r.revenue)), 1);
                    const maxProfit  = Math.max(...reports.map(r => Math.abs(r.profit)), 1);
                    const fmtYoy = (v: number | null) =>
                      v == null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;
                    return (
                      <div className="space-y-1.5">
                        {reports.map((r) => {
                          const bothUp   = (r.revenueYoy ?? 0) > 0 && (r.profitYoy ?? 0) > 0;
                          const bothDown = (r.revenueYoy ?? 0) < 0 && (r.profitYoy ?? 0) < 0;
                          const bull = bothUp ? 'up' : bothDown ? 'down' : 'neutral';
                          const bullText = bothUp ? '看多' : bothDown ? '看空' : '中性';
                          const revPct = Math.max((Math.abs(r.revenue) / maxRevenue) * 100, 6);
                          const profPct = Math.max((Math.abs(r.profit) / maxProfit) * 100, 6);
                          const revColor = (r.revenueYoy ?? 0) >= 0;
                          const profColor = (r.profitYoy ?? 0) >= 0;
                          return (
                            <div key={r.reportDate} className="space-y-1">
                              {/* 期标 + 情绪 */}
                              <div className="flex items-center gap-1.5">
                                <span className="font-medium text-ink-700">{r.shortLabel}</span>
                                <span className="text-ink-400">·</span>
                                <span className="text-ink-500">{r.reportType}</span>
                                <span className={cn(
                                  'ml-auto rounded px-1.5 py-0.5 text-[10px] font-medium leading-none',
                                  bull === 'up'
                                    ? 'bg-up/10 text-up'
                                    : bull === 'down'
                                      ? 'bg-down/10 text-down'
                                      : 'bg-ink-100 text-ink-500',
                                )}>
                                  {bullText}
                                </span>
                              </div>
                              {/* 柱形图 */}
                              <div className="space-y-0.5">
                                <div className="flex items-center gap-1">
                                  <span className="w-5 shrink-0 text-[9px] text-ink-400">营收</span>
                                  <div className="flex-1">
                                    <div
                                      className={cn(
                                        'flex items-center rounded-sm px-1.5 py-0.5 text-[10px] font-medium transition-all',
                                        revColor ? 'bg-red-100/50 text-ink-600' : 'bg-green-100/50 text-ink-600',
                                      )}
                                      style={{ width: `${revPct}%` }}
                                    >
                                      {fmtAmount(r.revenue)}
                                    </div>
                                  </div>
                                  <span className={cn('w-14 shrink-0 text-right text-[10px] tabular', revColor ? 'text-up' : 'text-down')}>
                                    {fmtYoy(r.revenueYoy)}
                                  </span>
                                </div>
                                <div className="flex items-center gap-1">
                                  <span className="w-5 shrink-0 text-[9px] text-ink-400">净利</span>
                                  <div className="flex-1">
                                    <div
                                      className={cn(
                                        'flex items-center rounded-sm px-1.5 py-0.5 text-[10px] font-medium transition-all',
                                        profColor ? 'bg-red-100/50 text-ink-600' : 'bg-green-100/50 text-ink-600',
                                      )}
                                      style={{ width: `${profPct}%` }}
                                    >
                                      {fmtAmount(r.profit)}
                                    </div>
                                  </div>
                                  <span className={cn('w-14 shrink-0 text-right text-[10px] tabular', profColor ? 'text-up' : 'text-down')}>
                                    {fmtYoy(r.profitYoy)}
                                  </span>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })()
                )}
              </>
            ) : (
              <div className="flex h-full items-center justify-center text-[11px] text-ink-400">
                暂无业绩报告
              </div>
            )}
          </div>
        </div>
      ) : (
        <SkeletonRows />
      )}
    </DataCard>
  );
}

// ============================================================
// 子组件：资金流卡片
// ============================================================

function MoneyFlowCard({
  data, ts, loading, mfklines, mfkLoading, error,
}: {
  data:       MoneyFlow | null;
  ts:         number | null;
  loading:    boolean;
  mfklines:   MFKlineBar[];
  mfkLoading: boolean;
  error?:     Error | null;
}) {
  return (
    <DataCard title="资金面" icon={<Wallet size={12} />} ts={ts} loading={loading && !data && !mfklines.length}>
      <div className="space-y-1.5 text-xs tabular">
        {/* ── 今日明细 ── */}
        <div className="text-[10px] font-semibold tracking-wide text-ink-400">今日</div>
        {error ? (
          <div className="py-2 text-center">
            <p className="text-[11px] text-down">数据加载失败</p>
            <p className="mt-0.5 break-all text-[10px] text-ink-400">{error.message}</p>
          </div>
        ) : data ? (
          <>
            <div className="flex items-center justify-between font-medium">
              <span className="text-ink-500">主力净流入</span>
              <span className={cn(colorClass(data.mainNet))}>
                {fmtAmount(data.mainNet)}&nbsp;({fmtPct(data.mainPct)})
              </span>
            </div>
            <FlowRow label="超大单" net={data.superLargeNet} pct={data.superLargePct} />
            <FlowRow label="大单"   net={data.largeNet}      pct={data.largePct} />
            <FlowRow label="中单"   net={data.mediumNet}     pct={data.mediumPct} />
            <FlowRow label="小单"   net={data.smallNet}      pct={data.smallPct} />
          </>
        ) : loading ? (
          <SkeletonRows />
        ) : (
          <div className="py-2 text-center text-[11px] text-ink-400">暂无资金流数据</div>
        )}

        {/* ── 近 10 日趋势 ── */}
        <div className="border-t border-ink-100 pt-1.5">
          <div className="mb-1.5 text-[10px] font-semibold tracking-wide text-ink-400">近 20 日主力净流入</div>
          {mfklines.length > 0 ? (
            <MFBarChart bars={mfklines} />
          ) : mfkLoading ? (
            <div className="h-10 animate-pulse rounded bg-ink-100" />
          ) : null}
        </div>
      </div>
    </DataCard>
  );
}

// ============================================================
// 子组件：技术面卡片（收盘价折线图 + 技术指标文字摘要）
// ============================================================

/** 技术面整体情绪判断（基于 summarizeTechnicals 输出文本） */
function parseTechnicalSentiment(text: string): { sentiment: 'up' | 'down' | 'neutral'; label: string } {
  if (/多头排列/.test(text)) {
    if (/金叉|红柱扩张/.test(text)) return { sentiment: 'up',   label: '强势看多' };
    return                                 { sentiment: 'up',   label: '偏多趋势' };
  }
  if (/空头排列/.test(text)) {
    if (/死叉|绿柱扩张/.test(text)) return { sentiment: 'down', label: '强势看空' };
    return                                  { sentiment: 'down', label: '偏空趋势' };
  }
  if (/金叉/.test(text))        return { sentiment: 'up',      label: '金叉看多' };
  if (/死叉/.test(text))        return { sentiment: 'down',    label: '死叉看空' };
  if (/红柱扩张/.test(text))    return { sentiment: 'up',      label: '多头动能' };
  if (/绿柱扩张/.test(text))    return { sentiment: 'down',    label: '空头动能' };
  if (/严重超卖|超卖区域/.test(text)) return { sentiment: 'up',  label: '超卖反弹' };
  if (/强烈超买/.test(text))    return { sentiment: 'down',    label: '超买风险' };
  if (/偏强/.test(text))        return { sentiment: 'up',      label: '偏强整理' };
  if (/偏弱/.test(text))        return { sentiment: 'down',    label: '偏弱震荡' };
  return                                { sentiment: 'neutral', label: '震荡中性' };
}

function TechnicalCard({
  text, bars, ts, loading,
}: {
  text:    string | null;
  bars:    KlineBar[];
  ts:      number | null;
  loading: boolean;
}) {
  const sent = text ? parseTechnicalSentiment(text) : null;

  return (
    <DataCard title="技术面（30日）" icon={<LineChart size={12} />} ts={ts} loading={loading}>
      {text ? (
        <div className="space-y-2">
          <PriceSparkline bars={bars} />

          {/* 情绪总判断 badge */}
          {sent && (
            <div className="flex items-center gap-1.5">
              <span className={cn(
                'rounded px-1.5 py-0.5 text-[10px] font-medium leading-none',
                sent.sentiment === 'up'
                  ? 'bg-up/10 text-up'
                  : sent.sentiment === 'down'
                    ? 'bg-down/10 text-down'
                    : 'bg-ink-100 text-ink-500',
              )}>
                技术面 · {sent.label}
              </span>
            </div>
          )}

          {/* 逐行展示指标，方向词变色 */}
          <div className="space-y-1 text-[11px] leading-snug">
            {text.trim().split('\n').map((raw, i) => {
              const line = raw.trim();
              if (!line) return null;
              const isBull = /多头排列|金叉|红柱扩张|超卖区域|严重超卖/.test(line);
              const isBear = /空头排列|死叉|绿柱扩张|强烈超买|超买区域/.test(line);
              return (
                <div key={i} className={cn(
                  isBull ? 'text-up' : isBear ? 'text-down' : 'text-ink-700',
                )}>
                  {line}
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <SkeletonRows />
      )}
    </DataCard>
  );
}

/** 60 日收盘价折线迷你图，渐变填充区域 + 末点圆点
 *  视觉优化：最小纵向范围 = 均价 × 4%，确保即使窄幅震荡也有高低起伏
 */
function PriceSparkline({ bars }: { bars: KlineBar[] }) {
  const recent = bars.slice(-30);
  if (recent.length < 3) return null;

  const prices = recent.map(b => b.close);
  const rawMn  = Math.min(...prices);
  const rawMx  = Math.max(...prices);
  const avg    = (rawMn + rawMx) / 2;
  // 确保最小纵向范围为均价的 5%，让小幅波动也可见
  const minRange = avg * 0.05;
  const halfR  = Math.max((rawMx - rawMn) / 2, minRange / 2);
  const mn     = avg - halfR;
  const mx     = avg + halfR;
  const rng    = mx - mn;

  const W = 240, H = 112, P = 4;

  const pts: [number, number][] = prices.map((p, i) => [
    P + (i / (prices.length - 1)) * (W - P * 2),
    P + (1 - (p - mn) / rng) * (H - P * 2),
  ]);
  const line = pts
    .map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`)
    .join(' ');
  const area = `${line} L${pts[pts.length-1][0].toFixed(1)} ${(H).toFixed(1)} L${pts[0][0].toFixed(1)} ${(H).toFixed(1)} Z`;

  const isUp = prices[prices.length - 1] >= prices[0];
  const clr  = isUp ? '#dc2626' : '#16a34a';
  const gid  = `sg-${isUp ? 'u' : 'd'}`;
  const [lx, ly] = pts[pts.length - 1];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ height: 104 }} className="w-full" preserveAspectRatio="none">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor={clr} stopOpacity="0.04" />
          <stop offset="100%" stopColor={clr} stopOpacity="0"    />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gid})`} />
      <path d={line} fill="none" stroke={clr} strokeWidth="0.8" opacity="0.2"
            strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={lx.toFixed(1)} cy={ly.toFixed(1)} r="1.5" fill={clr} opacity="0.25" />
    </svg>
  );
}

// ============================================================
// 子组件：近期公告卡片
// ============================================================

/** 公告情绪分析：基于标题/类型关键词判断看多/看空/中性 */
type AnnSentiment = { bull: 'up' | 'down' | 'neutral'; label: string };
function analyzeAnn(title: string, type: string): AnnSentiment {
  // ── 看多信号 ──
  if (/业绩预增|扭亏为盈|超预期|净利润.*增长|利润大增/.test(title))
    return { bull: 'up', label: '业绩预增' };
  if (/(股份?回购|增持股份|拟增持)/.test(title) && !/减持/.test(title))
    return { bull: 'up', label: '回购增持' };
  if (/股权激励|限制性股票|期权激励/.test(title))
    return { bull: 'up', label: '股权激励' };
  if (/(中标|获得.*合同|签署.*合同|重大合同|战略合作.*协议)/.test(title))
    return { bull: 'up', label: '重大合同' };
  if (/(并购|收购|重大资产重组|资产注入|借壳)/.test(title))
    return { bull: 'up', label: '资本运作' };
  if (/(分红|派息|现金股利|转增股本)/.test(title))
    return { bull: 'up', label: '分红派息' };
  if (/(获得批准|行政许可|注册申请通过|上市申请获批|审核通过|核准|批复同意)/.test(title))
    return { bull: 'up', label: '监管获批' };
  if (/(成立|设立|投资设立|合资设立).*(公司|基金|合伙企业)/.test(title))
    return { bull: 'up', label: '扩张布局' };
  if (/(增资|对.*增资|向.*增资|追加投资)/.test(title) && !/减资/.test(title))
    return { bull: 'up', label: '扩张布局' };
  if (/(获得|取得|获批).*(资质|许可证|牌照|经营许可)/.test(title))
    return { bull: 'up', label: '资质获批' };
  if (/(新能源|储能|绿电|光伏|风电|氢能).*(项目|基地|合同|中标|并网|投产)/.test(title))
    return { bull: 'up', label: '项目落地' };
  // ── 看空信号 ──
  if (/(业绩预减|预计亏损|由盈转亏|净利润.*下降|业绩下滑|大幅下降)/.test(title))
    return { bull: 'down', label: '业绩预警' };
  if (/减持/.test(title))
    return { bull: 'down', label: '股东减持' };
  if (/(问询函|关注函|监管函|质询函|整改通知)/.test(title))
    return { bull: 'down', label: '监管问询' };
  if (/(行政处罚|违规|责令改正|通报批评|立案调查)/.test(title))
    return { bull: 'down', label: '违规处罚' };
  if (/(诉讼|仲裁|被起诉|重大赔偿)/.test(title))
    return { bull: 'down', label: '诉讼风险' };
  if (/(退市|暂停上市|终止上市)/.test(title))
    return { bull: 'down', label: '退市风险' };
  if (/(债务|流动性危机|违约|逾期|资金链)/.test(title))
    return { bull: 'down', label: '债务风险' };
  // ── type 兜底 ──
  if (/增持/.test(type)) return { bull: 'up',      label: '增持信号' };
  if (/减持/.test(type)) return { bull: 'down',    label: '股东减持' };
  if (/回购/.test(type)) return { bull: 'up',      label: '股份回购' };
  if (/分红/.test(type)) return { bull: 'up',      label: '分红派息' };
  if (/诉讼|仲裁/.test(type)) return { bull: 'down', label: '诉讼风险' };
  if (/问询|关注函/.test(type)) return { bull: 'down', label: '监管问询' };
  // ── 中性常规 ──
  if (/(股东大会|临时股东会|年度股东会)/.test(title))
    return { bull: 'neutral', label: '股东大会' };
  if (/(董事会|监事会)/.test(title))
    return { bull: 'neutral', label: '董事会议' };
  if (/(辞职|任职|聘任|换届|选举)/.test(title))
    return { bull: 'neutral', label: '人事变动' };
  if (/(年度报告|年报|季度报告|半年报|中报)/.test(title))
    return { bull: 'neutral', label: '定期报告' };
  if (/(章程|会计政策|内控|修订|修改)/.test(title))
    return { bull: 'neutral', label: '制度变更' };
  return { bull: 'neutral', label: '常规公告' };
}


// ============================================================
// 原子级子组件
// ============================================================

type FundDesc = { text: string; bull: 'up' | 'down' | 'neutral' };

const descPE = (v: number | null | undefined): FundDesc | null => {
  if (v == null || !Number.isFinite(v)) return null;
  if (v < 0)   return { text: '产生亏损',   bull: 'down' };
  if (v < 15)  return { text: '低估区间',   bull: 'up' };
  if (v < 25)  return { text: '估值合理',   bull: 'neutral' };
  if (v < 40)  return { text: '估值略高',   bull: 'neutral' };
  if (v < 70)  return { text: '估值偏高',   bull: 'down' };
  if (v < 100) return { text: '高估区间',   bull: 'down' };
  return              { text: '估值过高',   bull: 'down' };
};
const descPB = (v: number | null | undefined): FundDesc | null => {
  if (v == null || !Number.isFinite(v)) return null;
  if (v < 0) return { text: '资不抵债',   bull: 'down' };
  if (v < 1) return { text: '已破净价值', bull: 'up' };
  if (v < 2) return { text: '净资低估',   bull: 'up' };
  if (v < 3) return { text: '市净率合理', bull: 'neutral' };
  if (v < 5) return { text: '市净率偏高', bull: 'down' };
  return       { text: '市净率高估', bull: 'down' };
};
const descROE = (v: number | null | undefined): FundDesc | null => {
  if (v == null || !Number.isFinite(v)) return null;
  if (v < 0)  return { text: '净产亏损',     bull: 'down' };
  if (v < 5)  return { text: '盈利能力偏弱', bull: 'down' };
  if (v < 10) return { text: '盈利能力一般', bull: 'neutral' };
  if (v < 15) return { text: '盈利能力良好', bull: 'up' };
  if (v < 20) return { text: '盈利能力优质', bull: 'up' };
  return        { text: '高盈利能力',   bull: 'up' };
};
const descEPS = (v: number | null | undefined): FundDesc | null => {
  if (v == null || !Number.isFinite(v)) return null;
  if (v < 0)   return { text: '亏损',     bull: 'down' };
  if (v < 0.1) return { text: '收益偏低', bull: 'down' };
  if (v < 0.5) return { text: '收益一般', bull: 'neutral' };
  if (v < 1)   return { text: '收益良好', bull: 'up' };
  return         { text: '收益优质', bull: 'up' };
};
const descTurnover = (v: number | null | undefined): FundDesc | null => {
  if (v == null || !Number.isFinite(v)) return null;
  if (v < 1)  return { text: '成交冷淡', bull: 'down' };
  if (v < 3)  return { text: '成交清淡', bull: 'neutral' };
  if (v < 5)  return { text: '换手正常', bull: 'neutral' };
  if (v < 8)  return { text: '换手活跃', bull: 'up' };
  if (v < 12) return { text: '换手较高', bull: 'neutral' };
  return        { text: '换手过热', bull: 'down' };
};
const descVolumeRatio = (v: number | null | undefined): FundDesc | null => {
  if (v == null || !Number.isFinite(v)) return null;
  if (v < 0.5) return { text: '严重缩量', bull: 'down' };
  if (v < 0.8) return { text: '温和缩量', bull: 'down' };
  if (v < 1.2) return { text: '量能平稳', bull: 'neutral' };
  if (v < 1.5) return { text: '温和放量', bull: 'up' };
  if (v < 2.5) return { text: '明显放量', bull: 'up' };
  if (v < 5)   return { text: '大幅放量', bull: 'up' };
  return         { text: '爆量警惕', bull: 'neutral' };
};
const descMarketCap = (v: number | null | undefined): FundDesc | null => {
  if (v == null || !Number.isFinite(v)) return null;
  const yi = v / 1e8;
  if (yi < 50)   return { text: '小盘股', bull: 'neutral' };
  if (yi < 200)  return { text: '中小盘', bull: 'neutral' };
  if (yi < 500)  return { text: '中盘股', bull: 'neutral' };
  if (yi < 2000) return { text: '中大盘', bull: 'neutral' };
  return           { text: '大盘股', bull: 'neutral' };
};

/** 基本面指标行：指标名 | 数字值 | 彩色专业描述标签，使用网格对齐 */
function FundRow({
  k, v, suffix = '', format, desc,
}: {
  k:       string;
  v:       number | null | undefined;
  suffix?: string;
  format?: 'yi';
  desc:    FundDesc | null;
}) {
  let display: string;
  if (v == null || !Number.isFinite(v)) {
    display = '—';
  } else if (format === 'yi') {
    display = `${(v / 1e8).toFixed(2)}亿`;
  } else {
    display = `${v.toFixed(2)}${suffix}`;
  }
  return (
    <div className="grid grid-cols-[4rem,1fr,auto] items-center gap-x-2">
      <span className="text-ink-500">{k}</span>
      <span className="text-right text-ink-800 tabular">{display}</span>
      {desc ? (
        <span className={cn(
          'rounded px-1 py-0.5 text-[10px] leading-none whitespace-nowrap',
          desc.bull === 'up'
            ? 'bg-up/10 text-up'
            : desc.bull === 'down'
              ? 'bg-down/10 text-down'
              : 'bg-ink-100 text-ink-500',
        )}>
          {desc.text}
        </span>
      ) : <span />}
    </div>
  );
}

/** 资金流单行（净流入 + 占比，自动涨跌色） */
function FlowRow({ label, net, pct }: { label: string; net: number; pct: number }) {
  return (
    <div className="flex items-center justify-between text-[11px]">
      <span className="text-ink-500">{label}</span>
      <span className={cn(colorClass(net))}>
        {fmtAmount(net)}&nbsp;({fmtPct(pct)})
      </span>
    </div>
  );
}

/** 近20日主力净流入柱状图，零线居中，流入红色（上）流出绿色（下）
 *  每根柱宽固定，高低差最大化利用可视高度，末点日期标注，连续趋势文字摘要
 */
function MFBarChart({ bars }: { bars: MFKlineBar[] }) {
  const n = bars.length;
  if (!n) return null;

  // 视图参数：宽=240，高=120，零线在中心60
  const W = 240, H = 120, zero = 60;
  const gap = 1.5;                      // 柱间隙
  const slotW = W / n;                  // 每格宽度
  const bw = Math.max(slotW - gap, 2);  // 柱宽，最小 2px

  // 最大绝对值（用于高度映射），保留 2px padding
  const maxAbs = Math.max(...bars.map((b) => Math.abs(b.mainNet)), 1);
  const usable = zero - 3;              // 单侧最大可用像素 (60-3=57)

  // 末尾连续方向
  const lastIsIn = bars[n - 1].mainNet > 0;
  let streak = 0;
  for (let i = n - 1; i >= 0; i--) {
    if ((bars[i].mainNet > 0) === lastIsIn) streak++;
    else break;
  }

  // 稀疏 x 轴标签：首、中、末
  const labelIdxs = new Set([0, Math.floor(n / 2), n - 1]);

  return (
    <div className="space-y-1">
      <svg viewBox={`0 0 ${W} ${H}`} style={{ height: 112 }} className="w-full" preserveAspectRatio="none">
        {/* 零线 */}
        <line x1="0" y1={zero} x2={W} y2={zero} stroke="#d1d5db" strokeWidth="0.8" strokeDasharray="2 2" />
        {bars.map((bar, i) => {
          const isIn = bar.mainNet > 0;
          // 高度按 sqrt 缩放，使小柱也清晰可见，大柱不溢出
          const rawRatio = Math.abs(bar.mainNet) / maxAbs;
          const h = Math.max(rawRatio * usable, 1.5);
          const x = i * slotW + (slotW - bw) / 2;
          return (
            <rect
              key={bar.date}
              x={x.toFixed(1)}
              y={isIn ? (zero - h).toFixed(1) : zero.toString()}
              width={bw.toFixed(1)}
              height={h.toFixed(1)}
              fill={isIn ? '#fca5a5' : '#86efac'}
              opacity={0.4}
              rx="0.5"
            >
              <title>{`${bar.date.slice(5)}  ${bar.mainNet >= 0 ? '+' : ''}${bar.mainPct.toFixed(2)}%  ${fmtAmount(bar.mainNet)}`}</title>
            </rect>
          );
        })}
      </svg>
      {/* 稀疏日期标注 + 连续趋势 */}
      <div className="relative text-[10px] text-ink-400" style={{ height: 14 }}>
        {bars.map((bar, i) =>
          labelIdxs.has(i) ? (
            <span
              key={i}
              className="absolute"
              style={{
                left: `${((i + 0.5) / n) * 100}%`,
                transform: i === 0 ? 'none' : i === n - 1 ? 'translateX(-100%)' : 'translateX(-50%)',
              }}
            >
              {bar.date.slice(5)}
            </span>
          ) : null
        )}
        {streak >= 3 && (
          <span
            className={cn('absolute right-0 font-medium', lastIsIn ? 'text-up' : 'text-down')}
            style={{ top: 0 }}
          >
            连续{streak}日净{lastIsIn ? '流入' : '流出'}
          </span>
        )}
      </div>
    </div>
  );
}

// ============================================================
// 行情对比：今日 / 昨日各项指标
// ============================================================

/** 单日行情面板：开/收/高/低/振幅/平均成本 + 相对基准价变动%，两列布局 */
function DayPanel({
  title, open, close, high, low, prevClose, changePct, turnover, volumeRatio,
}: {
  title:       string;
  open:        number;
  close:       number;
  high:        number;
  low:         number;
  prevClose:   number;
  changePct:   number;
  turnover:    number | null;
  volumeRatio: number | null;
}) {
  const pct = (v: number) =>
    Number.isFinite(v) && Number.isFinite(prevClose) && prevClose !== 0
      ? (v - prevClose) / prevClose * 100
      : NaN;

  const amplitude =
    Number.isFinite(high) && Number.isFinite(low) && Number.isFinite(prevClose) && prevClose !== 0
      ? (high - low) / prevClose * 100
      : NaN;

  // 平均成本 = (开盘 + 收盘 + 最高 + 最低) / 4
  const avgCost = Number.isFinite(open) && Number.isFinite(close) && Number.isFinite(high) && Number.isFinite(low)
    ? (open + close + high + low) / 4
    : NaN;

  // 是否显示量比/换手（有数据时才显示）
  const showExtra = turnover != null || volumeRatio != null;

  return (
    <div className="flex-1 px-3 py-2">
      <div className="mb-1.5 text-[11px] font-medium text-ink-400">{title}</div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-[3px] text-[11px]">
        {/* 左列 */}
        <div className="grid grid-cols-[1.8rem,1fr,3rem] gap-x-1">
          <span className="text-ink-400">开盘</span>
          <span className="text-right text-ink-700">{fmtPrice(open)}</span>
          <PctCell v={pct(open)} />

          <span className="text-ink-400">最高</span>
          <span className="text-right text-ink-700">{fmtPrice(high)}</span>
          <PctCell v={pct(high)} />

          <span className="text-ink-400">振幅</span>
          <span className="text-right text-ink-700">{Number.isFinite(amplitude) ? `${amplitude.toFixed(2)}%` : '—'}</span>
          <span className="w-[3rem]" />

          {showExtra && (
            <>
              <span className="text-ink-400">量比</span>
              <span className="text-right text-ink-700">{volumeRatio != null ? volumeRatio.toFixed(2) : '—'}</span>
              <span className="w-[3rem]" />
            </>
          )}
        </div>

        {/* 右列 */}
        <div className="grid grid-cols-[1.8rem,1fr,3rem] gap-x-1">
          <span className="text-ink-400">收盘</span>
          <span className="text-right text-ink-700">{fmtPrice(close)}</span>
          <PctCell v={changePct} />

          <span className="text-ink-400">最低</span>
          <span className="text-right text-ink-700">{fmtPrice(low)}</span>
          <PctCell v={pct(low)} />

          {!showExtra && (
            <>
              <span className="text-ink-400">均价</span>
              <span className="text-right text-ink-700">{fmtPrice(avgCost)}</span>
              <PctCell v={pct(avgCost)} />
            </>
          )}

          {showExtra && (
            <>
              <span className="text-ink-400">换手</span>
              <span className="text-right text-ink-700">{turnover != null ? turnover.toFixed(2) + '%' : '—'}</span>
              <span className="w-[3rem]" />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** 带涨跌色的百分比单元格 */
function PctCell({ v }: { v: number }) {
  return (
    <span className={cn('text-right text-[11px]', colorClass(v))}>
      {Number.isFinite(v) ? `${v >= 0 ? '+' : ''}${v.toFixed(2)}%` : '—'}
    </span>
  );
}

/** 四维度评分进度条 */
function ScoreBars({ scores }: { scores: Record<string, number> }) {
  const dims = ['基本面', '技术面', '资金面', '消息面'];
  return (
    <div className="grid grid-cols-4 gap-3">
      {dims.map((k) => {
        const v    = Math.max(0, Math.min(10, Number(scores[k] ?? 0)));
        const tone = v >= 7 ? 'bg-up' : v >= 4 ? 'bg-ink-400' : 'bg-down';
        return (
          <div key={k}>
            <div className="mb-1 flex items-baseline justify-between text-[11px]">
              <span className="text-ink-500">{k}</span>
              <span className="tabular font-medium text-ink-800">{v}/10</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded bg-ink-100">
              <div className={cn('h-full transition-all duration-500', tone)} style={{ width: `${v * 10}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** 分析结果每个小节的标题 + 内容 */
function AnalysisSection({
  label, tone, children,
}: {
  label:    string;
  tone?:    'up' | 'down';
  children: React.ReactNode;
}) {
  return (
    <div>
      <div
        className={cn(
          'mb-1.5 text-[11px] font-medium uppercase tracking-wider',
          tone === 'up'   ? 'text-up'   :
          tone === 'down' ? 'text-down' :
          'text-ink-400',
        )}
      >
        {label}
      </div>
      {children}
    </div>
  );
}

// ============================================================
// 子组件：AI 分析弹窗（全屏蒙层 + 卡片式弹窗）
// ============================================================

interface AnalysisModalProps {
  stockName:  string | undefined;
  modelLabel: string;
  result:     AnalysisResult | null;
  streaming:  string;
  loading:    boolean;
  error:      string | null;
  onClose:    () => void;
  onStop:     () => void;
}

/** 判断 result 是否有真实可见内容（避免空对象误判为已有结果） */
function hasVisibleContent(result: AnalysisResult | null): boolean {
  if (!result) return false;
  return !!(result.conclusion || result.bullish?.length || result.bearish?.length ||
    result.risks?.length || result.suggestion || result.raw);
}

function AnalysisModal({
  stockName, modelLabel, result, streaming, loading, error, onClose, onStop,
}: AnalysisModalProps) {
  // 有真实内容才算「结果到位」
  const resultReady = hasVisibleContent(result);
  return (
    // 无遮罩：pointer-events-none 让点击穿透到主页面，modal 卡片自身恢复 pointer-events-auto
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
      <div className="relative flex max-h-[90vh] w-full max-w-4xl flex-col rounded-xl border border-ink-200 bg-white shadow-2xl pointer-events-auto">
        {/* ── 弹窗头部 ── */}
        <div className="flex shrink-0 items-center justify-between border-b border-ink-100 px-6 py-4">
          <div className="flex items-center gap-3">
            <Sparkles className="text-primary" size={18} />
            <div>
              <h2 className="text-base font-semibold text-ink-800">
                AI 多维分析
                {stockName && <span className="ml-2 text-ink-500">· {stockName}</span>}
              </h2>
              <p className="mt-0.5 text-[11px] text-ink-400">
                使用模型：{modelLabel}
              </p>
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            {loading && (
              <button
                onClick={onStop}
                className="flex items-center gap-1.5 rounded-lg border border-down/30 bg-down/5 px-3 py-1.5 text-xs font-medium text-down transition-colors hover:bg-down/10"
              >
                <Square size={12} />
                停止生成
              </button>
            )}
            <button
              onClick={onClose}
              className="rounded-lg p-2 text-ink-400 transition-colors hover:bg-ink-100 hover:text-ink-700"
              aria-label="关闭"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* ── 弹窗内容区（可滚动） ── */}
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          <div className="space-y-4">
            {/* 错误提示 */}
            {error && (
              <div className="space-y-3">
                <div className="rounded-lg border border-down/30 bg-down/5 p-4 text-sm text-down">
                  <div className="font-medium">分析失败</div>
                  <div className="mt-1 text-xs">{error}</div>
                </div>
                {/* 如果有部分输出，也显示出来 */}
                {streaming && (
                  <div>
                    <div className="mb-2 text-xs text-ink-500">已收到的部分内容：</div>
                    <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-lg bg-ink-50 p-4 text-sm text-ink-700">
                      {streaming}
                    </pre>
                  </div>
                )}
              </div>
            )}

            {/* 流式输出：loading 中 或 result 无真实内容时持续显示，绝不提前清空 */}
            {streaming && !resultReady && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-xs text-ink-500">
                  <span>{loading ? '正在分析中，实时输出：' : '分析完成，正在解析结果...'}</span>
                  {loading && (
                    <div className="flex gap-0.5">
                      <span className="h-1 w-1 animate-bounce rounded-full bg-primary" style={{ animationDelay: '0ms' }} />
                      <span className="h-1 w-1 animate-bounce rounded-full bg-primary" style={{ animationDelay: '150ms' }} />
                      <span className="h-1 w-1 animate-bounce rounded-full bg-primary" style={{ animationDelay: '300ms' }} />
                    </div>
                  )}
                </div>
                <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-lg bg-ink-50 p-4 text-sm leading-relaxed text-ink-700 shadow-inner">
                  {streaming}
                  {loading && <span className="ml-0.5 inline-block h-4 w-2 animate-pulse bg-primary" />}
                </pre>
              </div>
            )}

            {/* 初始提示 */}
            {!streaming && !resultReady && !error && (
              <div className="py-16 text-center">
                <Sparkles className="mx-auto mb-3 text-ink-300" size={32} />
                <p className="text-sm text-ink-400">
                  {loading ? '正在启动 AI 分析引擎...' : '准备就绪，等待分析'}
                </p>
              </div>
            )}

            {/* 解析失败降级：展示原文 */}
            {result?.raw && (
              <>
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                  ⚠️ 模型未输出合规 JSON，以下为原始内容（长度: {result.raw.length} 字符）
                </div>
                <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-lg bg-ink-50 p-4 text-sm text-ink-700">
                  {result.raw}
                </pre>
              </>
            )}

            {/* 维度评分条 */}
            {result?.scores && Object.keys(result.scores).length > 0 && (
              <ScoreBars scores={result.scores as Record<string, number>} />
            )}

            {/* 综合结论 */}
            {result?.conclusion && (
              <AnalysisSection label="综合结论">
                <p className="rounded-lg bg-ink-50 p-4 text-sm leading-relaxed text-ink-800">
                  {result.conclusion}
                </p>
              </AnalysisSection>
            )}

            {/* 看多理由 */}
            {result?.bullish?.length ? (
              <AnalysisSection label="看多理由" tone="up">
                <ul className="space-y-2 text-sm">
                  {result.bullish.map((b, i) => (
                    <li key={i} className="flex gap-2.5 rounded-lg bg-up/5 p-3">
                      <span className="shrink-0 text-up">+</span>
                      <span className="text-ink-800">{b}</span>
                    </li>
                  ))}
                </ul>
              </AnalysisSection>
            ) : null}

            {/* 看空理由 */}
            {result?.bearish?.length ? (
              <AnalysisSection label="看空理由" tone="down">
                <ul className="space-y-2 text-sm">
                  {result.bearish.map((b, i) => (
                    <li key={i} className="flex gap-2.5 rounded-lg bg-down/5 p-3">
                      <span className="shrink-0 text-down">−</span>
                      <span className="text-ink-800">{b}</span>
                    </li>
                  ))}
                </ul>
              </AnalysisSection>
            ) : null}

            {/* 风险提示 */}
            {result?.risks?.length ? (
              <AnalysisSection label="风险提示">
                <ul className="space-y-2 text-sm text-ink-700">
                  {result.risks.map((r, i) => (
                    <li key={i} className="rounded-lg bg-amber-50 p-3">
                      • {r}
                    </li>
                  ))}
                </ul>
              </AnalysisSection>
            ) : null}

            {/* 操作建议 */}
            {result?.suggestion && (
              <AnalysisSection label="操作建议（仅供参考）">
                <p className="rounded-lg bg-primary/5 p-4 text-sm leading-relaxed text-ink-800">
                  {result.suggestion}
                </p>
              </AnalysisSection>
            )}
          </div>
        </div>

        {/* ── 弹窗底部（可选的操作按钮区域） ── */}
        {result && !loading && (
          <div className="shrink-0 border-t border-ink-100 px-6 py-4 text-center text-xs text-ink-400">
            以上分析由 AI 生成，仅供参考，投资有风险
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================
// 导出组件：近期公告侧边栏面板（与财经快讯共同展示在右侧栏）
// ============================================================

export function AnnouncementPanel() {
  const selectedCode = useAppStore((s) => s.selectedCode);

  const annQ = usePolling(
    () => selectedCode
      ? fetchAnnouncements(selectedCode, 8)
      : Promise.resolve({ data: [], ts: Date.now() }),
    () => adaptiveInterval(10 * 60_000, 30 * 60_000),
    [selectedCode],
  );
  const announcements = annQ.data?.data ?? [];

  const todayStr = (() => {
    const d = new Date();
    return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  })();

  const todayAnns  = announcements.filter((a) => a.date.startsWith(todayStr));
  const olderAnns  = announcements.filter((a) => !a.date.startsWith(todayStr));
  const sortedData = [...todayAnns, ...olderAnns].slice(0, 8);

  return (
    <div className="flex h-full flex-col">
      {/* 公告列表 */}
      <ul className="flex-1 divide-y divide-ink-100 overflow-y-auto">
        {!selectedCode && (
          <li className="px-4 py-8 text-center text-xs text-ink-400">请先选择一只股票</li>
        )}
        {selectedCode && annQ.loading && !sortedData.length && (
          <li className="px-4 py-8 text-center text-xs text-ink-400">加载中…</li>
        )}
        {selectedCode && !annQ.loading && !sortedData.length && (
          <li className="px-4 py-8 text-center text-xs text-ink-400">近期无重大公告</li>
        )}
        {sortedData.map((a, i) => {
          const sent     = analyzeAnn(a.title, a.type);
          const sentText = sent.bull === 'up' ? '看多' : sent.bull === 'down' ? '看空' : '中性';
          const isToday  = a.date.startsWith(todayStr);
          return (
            <li key={i} className={cn('px-4 py-2.5 hover:bg-ink-50 transition-colors', isToday && 'bg-amber-50/50')}>
              <div className="flex items-center gap-1.5 text-[10px] mb-0.5">
                <span className={cn('tabular', isToday ? 'font-semibold text-amber-600' : 'text-ink-400')}>
                  {a.date}
                </span>
                {isToday && <span className="rounded bg-amber-400/20 px-1 py-0.5 font-semibold text-amber-600">今日</span>}
                {a.type && <span className="rounded bg-ink-100 px-1 py-0.5 text-ink-500">{a.type}</span>}
                <span className={cn(
                  'ml-auto whitespace-nowrap rounded px-1.5 py-0.5 font-medium leading-none',
                  sent.bull === 'up' ? 'bg-up/10 text-up'
                    : sent.bull === 'down' ? 'bg-down/10 text-down'
                    : 'bg-ink-100 text-ink-500',
                )}>
                  {sent.label} · {sentText}
                </span>
              </div>
              {a.url ? (
                <a href={a.url} target="_blank" rel="noreferrer"
                  className={cn('block text-xs leading-snug hover:text-ink-950 hover:underline',
                    isToday ? 'font-semibold text-ink-900' : 'text-ink-700')}>
                  {a.title}
                </a>
              ) : (
                <p className={cn('text-xs leading-snug', isToday ? 'font-semibold text-ink-900' : 'text-ink-700')}>
                  {a.title}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}