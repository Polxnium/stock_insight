import { useState } from 'react';
import { ChevronsLeft, ChevronsRight, Zap, TrendingUp, Building2, Globe } from 'lucide-react';
import { fetchNews } from '@/api';
import { usePolling } from '@/hooks/usePolling';
import { adaptiveInterval } from '@/lib/marketTime';
import { FreshBadge } from './FreshBadge';
import { cn } from '@/lib/format';

interface NewsFeedProps {
  collapsed?: boolean;
  onToggle?: () => void;
}

type NewsCategory = 'all' | 'important' | 'industry' | 'macro';

const categories = [
  { id: 'all' as NewsCategory, label: '全部', icon: Zap },
  { id: 'important' as NewsCategory, label: '重要', icon: TrendingUp },
  { id: 'industry' as NewsCategory, label: '行业', icon: Building2 },
  { id: 'macro' as NewsCategory, label: '宏观', icon: Globe },
];

// 重要新闻关键词
const IMPORTANT_KEYWORDS = ['政治局', '国务院', '央行', '证监会', '银保监会', '发改委', '财政部', '重磅', '紧急', '突发', '涨停', '跌停', 'IPO', '重组', '退市'];

// 行业新闻关键词
const INDUSTRY_KEYWORDS = ['行业', '板块', '产业链', '产能', '需求', '供给', '价格', '龙头', '企业', '公司', '业绩', '净利润', '营收'];

// 宏观新闻关键词
const MACRO_KEYWORDS = ['GDP', 'CPI', 'PPI', '货币政策', '财政政策', '利率', '汇率', '通胀', '就业', 'PMI', '进出口', '消费', '投资'];

function categorizeNews(title: string): NewsCategory {
  const lowerTitle = title.toLowerCase();
  
  if (IMPORTANT_KEYWORDS.some(keyword => lowerTitle.includes(keyword.toLowerCase()))) {
    return 'important';
  }
  if (INDUSTRY_KEYWORDS.some(keyword => lowerTitle.includes(keyword.toLowerCase()))) {
    return 'industry';
  }
  if (MACRO_KEYWORDS.some(keyword => lowerTitle.includes(keyword.toLowerCase()))) {
    return 'macro';
  }
  return 'all';
}

export function NewsFeed({ collapsed = false, onToggle }: NewsFeedProps) {
  const [activeCategory, setActiveCategory] = useState<NewsCategory>('all');
  
  const { data, loading, updatedAt } = usePolling(
    () => fetchNews(60),
    () => adaptiveInterval(20_000, 120_000),
  );
  const list = data?.data ?? [];

  const filteredList = activeCategory === 'all' 
    ? list 
    : list.filter(n => categorizeNews(n.title) === activeCategory);

  /* ── 收起态：细条 + 展开按钮 ─────────────────────── */
  if (collapsed) {
    return (
      <div className="flex h-full min-h-[200px] flex-col items-center justify-center rounded-lg border border-ink-200 bg-gradient-to-b from-white to-ink-50">
        <button
          onClick={onToggle}
          title="展开财经快讯"
          className="group flex flex-col items-center gap-3 rounded-lg px-2 py-4 transition-all hover:bg-white hover:shadow-sm"
        >
          <ChevronsLeft size={18} className="text-ink-400 transition-transform group-hover:scale-110 group-hover:text-ink-700" />
          <span
            className="text-[11px] font-medium text-ink-500 select-none group-hover:text-ink-800"
            style={{ writingMode: 'vertical-rl', textOrientation: 'mixed' }}
          >
            财经快讯
          </span>
        </button>
      </div>
    );
  }

  /* ── 展开态 ───────────────────────────────────────── */
  return (
    <div className="h-[715px] flex flex-col rounded-lg border border-ink-200 bg-white">
      <div className="flex shrink-0 items-center justify-between border-b border-ink-100 px-4 py-2">
        <h2 className="text-sm font-medium">财经快讯</h2>
        <div className="flex items-center gap-2">
          <FreshBadge ts={updatedAt} loading={loading && list.length === 0} className="text-xs" />
          <button
            onClick={onToggle}
            title="收起财经快讯"
            className="rounded-md bg-ink-50 p-1.5 text-ink-500 transition-all hover:bg-ink-900 hover:text-white hover:shadow-sm"
          >
            <ChevronsRight size={16} />
          </button>
        </div>
      </div>

      {/* 分类标签 */}
      <div className="flex shrink-0 gap-1 border-b border-ink-100 px-3 py-1.5">
        {categories.map((cat) => {
          const Icon = cat.icon;
          const isActive = activeCategory === cat.id;
          return (
            <button
              key={cat.id}
              onClick={() => setActiveCategory(cat.id)}
              className={cn(
                'flex items-center gap-1 rounded px-2 py-1 text-xs transition-colors',
                isActive
                  ? 'bg-ink-900 text-white'
                  : 'text-ink-500 hover:bg-ink-100 hover:text-ink-700',
              )}
            >
              <Icon size={10} />
              {cat.label}
            </button>
          );
        })}
      </div>

      <ul className="flex-1 divide-y divide-ink-100 overflow-y-auto">
        {filteredList.map((n) => {
          const category = categorizeNews(n.title);
          const isImportant = category === 'important';
          
          return (
            <li 
              key={n.id} 
              className={cn(
                'px-4 py-2.5 hover:bg-ink-50 transition-colors',
                isImportant && 'bg-amber-50/50 border-l-2 border-amber-400'
              )}
            >
              <a
                href={n.url}
                target="_blank"
                rel="noreferrer"
                className={cn(
                  'block min-h-[60px] text-sm leading-snug hover:text-ink-950',
                  isImportant ? 'font-medium text-ink-900' : 'text-ink-800'
                )}
              >
                <div className="flex items-start gap-2">
                  {isImportant && (
                    <span className="shrink-0 mt-0.5 rounded-full bg-amber-400 px-1 py-0.5 text-[9px] font-bold text-white">
                      重要
                    </span>
                  )}
                  <span className="shrink-0 pt-0.5 text-[11px] tabular text-ink-400">
                    {(n.time || '').slice(11, 16)}
                  </span>
                  <span className="line-clamp-2">{n.title}</span>
                </div>
              </a>
            </li>
          );
        })}
        {!loading && filteredList.length === 0 && (
          <li className="px-4 py-8 text-center text-xs text-ink-400">暂无新闻</li>
        )}
      </ul>
    </div>
  );
}