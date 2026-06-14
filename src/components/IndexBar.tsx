import { INDICES } from '@/config/indices';
import { fetchQuotes } from '@/api';
import { usePolling } from '@/hooks/usePolling';
import { adaptiveInterval } from '@/lib/marketTime';
import { cn, colorClass, fmtPct, fmtPrice } from '@/lib/format';
import { FreshBadge } from './FreshBadge';

export function IndexBar() {
  const codes = INDICES.map((i) => i.code);
  const { data, loading, updatedAt } = usePolling(
    () => fetchQuotes(codes),
    () => adaptiveInterval(5_000, 60_000),
    [codes.join(',')],
  );
  const quotes = data?.data;

  return (
    <div className="border-t border-ink-100 bg-white">
      <div className="mx-auto flex max-w-none flex-wrap items-center gap-y-1 px-6 py-2 text-[11px] tabular">
        {INDICES.map((idx) => {
          const q = quotes?.find((d) => d.code === idx.code);
          return (
            <div key={idx.code} className="flex items-center">
              {/* 境内/境外之间插入竖线分隔 */}
              {idx.divider && (
                <span className="mx-3 select-none text-ink-300">|</span>
              )}
              <div className="mr-6 flex items-center gap-1.5">
                <span className="text-ink-400">{idx.name}</span>
                <span className={cn('font-medium', colorClass(q?.changePct ?? 0))}>
                  {fmtPrice(q?.price ?? NaN)}
                </span>
                <span className={cn('text-[10px]', colorClass(q?.changePct ?? 0))}>
                  {fmtPct(q?.changePct ?? NaN)}
                </span>
              </div>
            </div>
          );
        })}
        <div className="ml-auto">
          <FreshBadge ts={updatedAt} loading={loading && !quotes} />
        </div>
      </div>
    </div>
  );
}
