import { useState, useMemo, useEffect, useRef } from 'react';
import { Plus, X, Search, ArrowUpDown, ChevronRight } from 'lucide-react';
import { fetchQuotes } from '@/api';
import { usePolling } from '@/hooks/usePolling';
import { adaptiveInterval } from '@/lib/marketTime';
import { useAppStore } from '@/store';
import { cn, colorClass, fmtPct, fmtPrice } from '@/lib/format';
import { FreshBadge } from './FreshBadge';

interface SearchResult {
  code: string;
  name: string;
  market?: string;
  price?: number;
  changePct?: number;
}

export function PositionList() {
  const positions     = useAppStore((s) => s.positions);
  const addPosition   = useAppStore((s) => s.addPosition);
  const removePosition = useAppStore((s) => s.removePosition);
  const selectedCode  = useAppStore((s) => s.selectedCode);
  const setSelectedCode = useAppStore((s) => s.setSelectedCode);

  const codes = positions.map((p) => p.code);
  const { data, loading, updatedAt } = usePolling(
    () =>
      codes.length
        ? fetchQuotes(codes)
        : Promise.resolve({ data: [], ts: Date.now() }),
    () => adaptiveInterval(5_000, 60_000),
    [codes.join(',')],
  );
  const quotes = data?.data;

  const [searchAddQuery, setSearchAddQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [showSearchResults, setShowSearchResults] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<number | null>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowSearchResults(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    if (!searchAddQuery.trim()) {
      setSearchResults([]);
      setShowSearchResults(false);
      return;
    }

    setShowSearchResults(true);
    debounceRef.current = window.setTimeout(async () => {
      setSearchLoading(true);
      try {
        const response = await fetch(`/api/search-stock?q=${encodeURIComponent(searchAddQuery)}`);
        const data = await response.json();
        
        if (data.ok && data.data) {
          const results = data.data as SearchResult[];
          if (results.length > 0) {
            const codes = results.map(s => s.code);
            const quoteRes = await fetchQuotes(codes);
            const quotes = quoteRes.data || [];
            const resultsWithQuote = results.map(stock => {
              const quote = quotes.find(q => q.code === stock.code);
              return {
                ...stock,
                price: quote?.price,
                changePct: quote?.changePct
              };
            });
            setSearchResults(resultsWithQuote);
          } else {
            setSearchResults(results);
          }
        } else {
          setSearchResults([]);
        }
      } catch {
        setSearchResults([]);
      } finally {
        setSearchLoading(false);
      }
    }, 300);

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [searchAddQuery]);

  const handleAddFromSearch = (code: string, name: string) => {
    addPosition({ code, alias: name });
    setSearchAddQuery('');
    setShowSearchResults(false);
  };

  const isInPositions = (code: string) => {
    return positions.some(p => p.code === code);
  };

  const [searchQuery, setSearchQuery] = useState('');

  // ── 计算振幅 ──────────────────────────────────────────
  const getAmplitude = (quote: any) => {
    if (!quote || !Number.isFinite(quote.high) || !Number.isFinite(quote.low) || !Number.isFinite(quote.prevClose) || quote.prevClose === 0) {
      return NaN;
    }
    return (quote.high - quote.low) / quote.prevClose * 100;
  };

  const [sortKey, setSortKey] = useState<'default' | 'price' | 'changePct' | 'amplitude'>('changePct');
  const [sortAsc, setSortAsc] = useState(false);

  const toggleSort = (key: 'price' | 'changePct' | 'amplitude') => {
    if (sortKey === key) {
      if (!sortAsc) setSortAsc(true);
      else { setSortKey('default'); setSortAsc(false); }
    } else {
      setSortKey(key); setSortAsc(false);
    }
  };

  const filteredList = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    let list = !q
      ? [...positions]
      : positions.filter((p) => {
          const name  = (quotes?.find((d) => d.code === p.code)?.name ?? p.alias ?? '').toLowerCase();
          const code  = p.code.toLowerCase();
          return name.includes(q) || code.includes(q);
        });

    if (sortKey !== 'default') {
      list.sort((a, b) => {
        const qa = quotes?.find((d) => d.code === a.code);
        const qb = quotes?.find((d) => d.code === b.code);
        let va: number, vb: number;
        if (sortKey === 'amplitude') {
          va = getAmplitude(qa) ?? -Infinity;
          vb = getAmplitude(qb) ?? -Infinity;
        } else {
          va = qa?.[sortKey] ?? -Infinity;
          vb = qb?.[sortKey] ?? -Infinity;
        }
        return sortAsc ? va - vb : vb - va;
      });
    }
    return list;
  }, [sortKey, sortAsc, searchQuery, positions, quotes, getAmplitude]);

  return (
    <div className="flex-1 max-h-[1025px] flex flex-col rounded-lg border border-ink-200 bg-white">
      <div className="flex items-center justify-end border-b border-ink-100 px-3 py-2">
        <div className="flex items-center gap-1.5">
          {(['price', 'changePct', 'amplitude'] as const).map((key) => {
            const label = key === 'price' ? '价' : key === 'changePct' ? '涨' : '振';
            const active = sortKey === key;
            const icon   = !active ? '↕' : sortAsc ? '↑' : '↓';
            const titles: Record<string, string> = {
              price: '按股价排序',
              changePct: '按涨幅排序',
              amplitude: '按振幅排序'
            };
            return (
              <button
                key={key}
                onClick={() => toggleSort(key)}
                title={titles[key]}
                className={cn(
                  'flex items-center gap-0.5 rounded px-1 py-0.5 text-[10px] transition',
                  active
                    ? 'bg-ink-900 text-white'
                    : 'text-ink-400 hover:bg-ink-100 hover:text-ink-700',
                )}
              >
                <ArrowUpDown size={9} className={active ? '' : 'opacity-60'} />
                {label}{icon}
              </button>
            );
          })}
          <span className="text-[11px] text-ink-300">·</span>
          <span className="text-[11px] text-ink-400">{positions.length} 只</span>
          <span className="text-[11px] text-ink-300">·</span>
          <FreshBadge ts={updatedAt} loading={loading && !quotes} className="text-[11px]" compact />
        </div>
      </div>

      <div className="flex items-center gap-1.5 border-b border-ink-100 px-3 py-1.5">
        <Search size={11} className="shrink-0 text-ink-300" />
        <input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="名称 / 代码筛选"
          className="flex-1 bg-transparent py-0.5 text-xs outline-none placeholder:text-ink-300"
        />
        {searchQuery && (
          <button onClick={() => setSearchQuery('')} className="text-ink-300 hover:text-ink-600">
            <X size={11} />
          </button>
        )}
      </div>

      <div className="relative" ref={dropdownRef}>
        <div className="flex items-center gap-1.5 border-b border-ink-100 px-3 py-1.5">
          <Search size={11} className="shrink-0 text-ink-300" />
          <input
            value={searchAddQuery}
            onChange={(e) => {
              setSearchAddQuery(e.target.value);
            }}
            onKeyDown={(e) => e.key === 'Enter' && e.preventDefault()}
            placeholder="搜索添加持仓"
            className="flex-1 bg-transparent py-0.5 text-xs outline-none placeholder:text-ink-300"
          />
          {searchAddQuery && (
            <button onClick={() => setSearchAddQuery('')} className="text-ink-300 hover:text-ink-600">
              <X size={11} />
            </button>
          )}
        </div>

        {showSearchResults && searchAddQuery && (
          <div className="absolute z-50 left-0 right-0 mt-1 rounded-lg border border-ink-200 bg-white shadow-lg overflow-hidden">
            {searchLoading ? (
              <div className="px-4 py-3 text-center text-xs text-ink-500">搜索中...</div>
            ) : searchResults.length > 0 ? (
              <ul className="max-h-48 overflow-y-auto">
                {searchResults.map((stock) => {
                  const inPositions = isInPositions(stock.code);
                  return (
                    <li
                      key={stock.code}
                      className="flex items-center justify-between px-3 py-1.5 hover:bg-ink-50 cursor-pointer"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-medium truncate">
                          {stock.name}
                          {inPositions && <span className="ml-2 text-[10px] text-ink-400">已持仓</span>}
                        </div>
                        <div className="text-[10px] text-ink-400">{stock.code}</div>
                      </div>
                      <div className="ml-2 grid shrink-0 grid-cols-[3.5rem_3.75rem_auto_auto] justify-items-end items-center gap-x-1">
                        {stock.price !== undefined && (
                          <>                            
                            <span className="w-full text-right tabular text-xs">{fmtPrice(stock.price)}</span>
                            <span className={cn('w-full text-right tabular text-[10px]', colorClass(stock.changePct ?? 0))}>
                              {fmtPct(stock.changePct ?? 0)}
                            </span>
                          </>
                        )}
                        {!inPositions && (
                          <button
                            onClick={() => {
                              handleAddFromSearch(stock.code, stock.name);
                            }}
                            className="p-0.5 rounded text-ink-400 hover:text-green-600 hover:bg-green-50 transition-colors"
                            title="添加到持仓"
                          >
                            <Plus size={11} />
                          </button>
                        )}
                        <ChevronRight size={11} className="text-ink-300" />
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <div className="px-4 py-3 text-center text-xs text-ink-500">未找到匹配的股票</div>
            )}
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        <ul className="divide-y divide-ink-100">
        {filteredList.map((p) => {
          const q      = quotes?.find((d) => d.code === p.code);
          const active = selectedCode === p.code;
          return (
            <li
              key={p.code}
              onClick={() => setSelectedCode(p.code)}
              className={cn(
                'group flex cursor-pointer items-center justify-between px-3 py-2 hover:bg-ink-50',
                active && 'bg-ink-50',
              )}
            >
              <div className="min-w-0 flex-1 overflow-hidden">
                <div className="truncate text-xs font-medium">
                  {q?.name || p.alias || p.code}
                </div>
                <div className="text-[10px] text-ink-400">{p.code}</div>
              </div>
              <div className="ml-2 grid shrink-0 grid-cols-[3.5rem_3.75rem_2.75rem_1.25rem] justify-items-end items-center gap-x-1 tabular">
                <span className={cn('text-xs w-full text-right', colorClass(q?.changePct ?? 0))}>
                  {fmtPrice(q?.price ?? NaN)}
                </span>
                <span
                  className={cn(
                    'w-full text-right rounded px-1 py-0.5 text-[11px]',
                    (q?.changePct ?? 0) >= 0
                      ? 'bg-up/10 text-up'
                      : 'bg-down/10 text-down',
                  )}
                >
                  {fmtPct(q?.changePct ?? NaN)}
                </span>
                <span className="w-full text-right text-[10px] text-ink-400">
                  {Number.isFinite(getAmplitude(q)) ? `${getAmplitude(q).toFixed(1)}%` : '—'}
                </span>
                <button
                  onClick={(e) => { e.stopPropagation(); removePosition(p.code); }}
                  className="flex items-center justify-center text-ink-300 opacity-0 transition group-hover:opacity-100 hover:text-down"
                  title="移除"
                >
                  <X size={12} />
                </button>
              </div>
            </li>
          );
        })}
        {filteredList.length === 0 && (
          <li className="px-3 py-6 text-center text-xs text-ink-400">
            {searchQuery ? `无匹配「${searchQuery}」` : '持仓股为空，添加一只开始'}
          </li>
        )}
        </ul>
      </div>
    </div>
  );
}