import { useEffect, useState } from 'react';
import { cn } from '@/lib/format';

/** 显示数据新鲜度，"刚刚 / N秒前 / N分钟前"，每5秒刷新。 */
export function FreshBadge({
  ts,
  className,
  loading,
  compact = false,
}: {
  ts: number | null;
  className?: string;
  loading?: boolean;
  compact?: boolean;
}) {
  const [, force] = useState(0);
  useEffect(() => {
    const t = setInterval(() => force((x) => x + 1), 5000);
    return () => clearInterval(t);
  }, []);

  const widthClass = compact ? 'w-[48px]' : 'w-[60px]';

  if (loading) return <span className={cn('inline-block text-right text-ink-400', widthClass, className)}>刷新中…</span>;
  if (!ts) return <span className={cn('inline-block text-right text-ink-400', widthClass, className)}>—</span>;

  const diff = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  let label = '刚刚';
  if (diff >= 60) label = `${Math.floor(diff / 60)}分钟前`;
  else if (diff >= 3) label = `${diff}秒前`;

  // 60s 内绿色，60s-5min 灰，>5min 红
  const tone =
    diff < 60 ? 'text-ink-500' : diff < 300 ? 'text-ink-400' : 'text-down';

  return <span className={cn('inline-block text-right tabular', widthClass, tone, className)}>{label}</span>;
}