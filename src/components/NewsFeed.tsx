import { useState } from 'react';
import { Zap, TrendingUp, Building2, Globe } from 'lucide-react';
import { fetchNews } from '@/api';
import { usePolling } from '@/hooks/usePolling';
import { adaptiveInterval } from '@/lib/marketTime';
import { cn } from '@/lib/format';

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

export function NewsFeed() {
  const [activeCategory, setActiveCategory] = useState<NewsCategory>('all');
  
  const { data, loading } = usePolling(
    () => fetchNews(60),
    () => adaptiveInterval(20_000, 120_000),
  );
  const list = data?.data ?? [];

  const filteredList = activeCategory === 'all' 
    ? list 
    : list.filter(n => categorizeNews(n.title) === activeCategory);

  return (
    <div className="flex h-full flex-col">
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
                  ? 'bg-ink-100 text-ink-800 font-medium'
                  : 'text-ink-500 hover:bg-ink-50 hover:text-ink-700',
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
                  'block min-h-[48px] text-xs leading-snug hover:text-ink-950',
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