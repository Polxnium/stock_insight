import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));

export const fmtPrice = (n: number, digits = 2) =>
  Number.isFinite(n) ? n.toFixed(digits) : '—';

export const fmtPct = (n: number) =>
  Number.isFinite(n) ? `${n >= 0 ? '+' : ''}${n.toFixed(2)}%` : '—';

export const fmtAmount = (n: number) => {
  if (!Number.isFinite(n)) return '—';
  const abs  = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs === 0) return '0';
  if (abs >= 1e8) return `${sign}${(abs / 1e8).toFixed(2)}亿`;
  if (abs >= 1e4) return `${sign}${(abs / 1e4).toFixed(2)}万`;
  return `${sign}${abs.toFixed(0)}`;
};

// 涨红跌绿（A 股习惯），平 = 灰
export const colorClass = (changePct: number) =>
  changePct > 0
    ? 'text-up'
    : changePct < 0
      ? 'text-down'
      : 'text-ink-500';
