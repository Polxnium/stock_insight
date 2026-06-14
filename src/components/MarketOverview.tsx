import { usePolling } from '@/hooks/usePolling';
import { fetchMarketOverview } from '@/api';
import { adaptiveInterval } from '@/lib/marketTime';
import { cn } from '@/lib/format';
import { ArrowUpRight, ArrowDownRight } from 'lucide-react';

export function MarketOverview() {
  const { data, loading } = usePolling(
    () => fetchMarketOverview(),
    () => adaptiveInterval(10_000, 60_000),
    [],
  );
  const overview = data?.data ?? null;

  const fmtAmount = (val: number) => {
    if (!val || !Number.isFinite(val)) return '—';
    if (val >= 1e12) return `${(val / 1e12).toFixed(2)}万亿`;
    if (val >= 1e8) return `${(val / 1e8).toFixed(0)}亿`;
    if (val >= 1e4) return `${(val / 1e4).toFixed(0)}万`;
    return val.toFixed(0);
  };

  const fmtNorth = (val: number | null) => {
    if (val == null || !Number.isFinite(val)) return '—';
    const abs = Math.abs(val);
    if (abs >= 1e8) return `${(val / 1e8).toFixed(1)}亿`;
    if (abs >= 1e4) return `${(val / 1e4).toFixed(0)}万`;
    return val.toFixed(0);
  };

  if (loading && !overview) {
    return (
      <div className="border-t border-ink-100 bg-ink-50/50">
        <div className="flex items-center gap-4 px-6 py-1.5 text-[11px]">
          <div className="h-3 w-32 animate-pulse rounded bg-ink-100" />
          <div className="h-3 w-24 animate-pulse rounded bg-ink-100" />
          <div className="h-3 w-20 animate-pulse rounded bg-ink-100" />
        </div>
      </div>
    );
  }

  if (!overview) return null;

  const { totalAmount, shAmount, szAmount, yestAmount, northNet, shChangePct, szChangePct } = overview;
  const isNorthIn = northNet !== null && northNet > 0;
  const isNorthOut = northNet !== null && northNet < 0;
  const volumeRatio = yestAmount > 0 ? totalAmount / yestAmount : null;

  return (
    <div className="border-t border-ink-100 bg-ink-50/50">
      <div className="flex items-center gap-4 px-6 py-1.5 text-[11px] tabular">
        {/* 今日成交额 */}
        <span className="flex items-center gap-1.5">
          <span className="text-ink-400">成交</span>
          <span className="font-medium text-ink-700">{fmtAmount(totalAmount)}</span>
          {volumeRatio !== null && (
            <span className={cn('text-[10px]', volumeRatio >= 1 ? 'text-up' : 'text-down')}>
              (较昨日{volumeRatio >= 1 ? '+' : ''}{((volumeRatio - 1) * 100).toFixed(0)}%)
            </span>
          )}
          <span className="text-ink-400 text-[10px]">
            昨{fmtAmount(yestAmount)}
          </span>
        </span>

        <span className="text-ink-300">|</span>

        {/* 北向资金 */}
        <span className="flex items-center gap-1.5">
          <span className="text-ink-400">北向</span>
          {northNet !== null ? (
            <>
              <span className={cn(
                'font-medium flex items-center gap-0.5',
                isNorthIn ? 'text-up' : isNorthOut ? 'text-down' : 'text-ink-500',
              )}>
                {isNorthIn ? <ArrowUpRight size={10} /> : isNorthOut ? <ArrowDownRight size={10} /> : null}
                {isNorthIn ? '+' : ''}{fmtNorth(northNet)}
              </span>
              <span className={cn('text-[10px]', isNorthIn ? 'text-up/70' : isNorthOut ? 'text-down/70' : 'text-ink-400')}>
                {isNorthIn ? '流入' : isNorthOut ? '流出' : '平盘'}
              </span>
            </>
          ) : (
            <span className="text-ink-400">暂无数据</span>
          )}
        </span>

        <span className="text-ink-300">|</span>

        {/* 涨跌 */}
        <span className="flex items-center gap-2">
          <span className="text-ink-400">上证</span>
          <span className={cn('font-medium', shChangePct >= 0 ? 'text-up' : 'text-down')}>
            {shChangePct >= 0 ? '+' : ''}{shChangePct.toFixed(2)}%
          </span>
          <span className="text-ink-400">深证</span>
          <span className={cn('font-medium', szChangePct >= 0 ? 'text-up' : 'text-down')}>
            {szChangePct >= 0 ? '+' : ''}{szChangePct.toFixed(2)}%
          </span>
        </span>
      </div>
    </div>
  );
}