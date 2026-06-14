import { useState, useEffect, useRef } from 'react';
import { Search, Plus, X, ChevronRight } from 'lucide-react';
import { fetchQuotes } from '@/api';
import { useAppStore } from '@/store';
import { cn, colorClass, fmtPrice, fmtPct } from '@/lib/format';

interface SearchResult {
  code: string;
  name: string;
  market?: string;
  price?: number;
  changePct?: number;
}

export function StockSearch() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<number | null>(null);

  const addStock = useAppStore((s) => s.addStock);
  const setSelectedCode = useAppStore((s) => s.setSelectedCode);
  const watchlist = useAppStore((s) => s.watchlist);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowResults(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    // 清除之前的防抖定时器
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    if (!query.trim()) {
      setResults([]);
      return;
    }

    // 防抖搜索：用户停止输入300ms后才发起请求
    debounceRef.current = window.setTimeout(async () => {
      setLoading(true);
      
      try {
        // 调用服务端搜索API
        const response = await fetch(`/api/search-stock?q=${encodeURIComponent(query)}`);
        const data = await response.json();
        
        if (data.ok && data.data) {
          const searchResults = data.data as SearchResult[];
          
          // 如果有搜索结果，批量获取行情数据
          if (searchResults.length > 0) {
            const codes = searchResults.map(s => s.code);
            const quoteRes = await fetchQuotes(codes);
            const quotes = quoteRes.data || [];
            
            const resultsWithQuote = searchResults.map(stock => {
              const quote = quotes.find(q => q.code === stock.code);
              return {
                ...stock,
                price: quote?.price,
                changePct: quote?.changePct
              };
            });
            
            setResults(resultsWithQuote);
          } else {
            setResults(searchResults);
          }
        } else {
          setResults([]);
        }
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 300);

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [query]);

  const handleAdd = (code: string, name: string) => {
    addStock({ code, alias: name });
    setQuery('');
    setShowResults(false);
  };

  const handleSelect = (code: string) => {
    setSelectedCode(code);
    setQuery('');
    setShowResults(false);
  };

  const isInWatchlist = (code: string) => {
    return watchlist.some(w => w.code === code);
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <div className="flex items-center gap-2 rounded-lg border border-ink-200 bg-white px-3 py-2">
        <Search size={14} className="text-ink-400" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setShowResults(true);
          }}
          onFocus={() => setShowResults(true)}
          placeholder="搜索股票名称或代码..."
          className="flex-1 bg-transparent text-sm outline-none placeholder:text-ink-400"
        />
        {query && (
          <button 
            onClick={() => setQuery('')} 
            className="text-ink-400 hover:text-ink-600"
          >
            <X size={14} />
          </button>
        )}
      </div>

      {showResults && query && (
        <div className="absolute z-50 left-0 right-0 mt-1 rounded-lg border border-ink-200 bg-white shadow-lg overflow-hidden">
          {loading ? (
            <div className="px-4 py-3 text-center text-sm text-ink-500">
              搜索中...
            </div>
          ) : results.length > 0 ? (
            <ul className="max-h-72 overflow-y-auto">
              {results.map((stock) => {
                const inWatchlist = isInWatchlist(stock.code);
                return (
                  <li
                    key={stock.code}
                    className="flex items-center justify-between px-3 py-2 hover:bg-ink-50 cursor-pointer"
                    onClick={() => handleSelect(stock.code)}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">
                        {stock.name}
                        {inWatchlist && <span className="ml-2 text-xs text-ink-400">已自选</span>}
                      </div>
                      <div className="text-xs text-ink-400">{stock.code}</div>
                    </div>
                    <div className="flex items-center gap-3 ml-3">
                      {stock.price !== undefined && (
                        <>
                          <span className="tabular text-sm">{fmtPrice(stock.price)}</span>
                          <span className={cn('tabular text-xs', colorClass(stock.changePct ?? 0))}>
                            {fmtPct(stock.changePct ?? 0)}
                          </span>
                        </>
                      )}
                      {!inWatchlist && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleAdd(stock.code, stock.name);
                          }}
                          className="p-1 rounded text-ink-400 hover:text-green-600 hover:bg-green-50 transition-colors"
                          title="添加到自选"
                        >
                          <Plus size={14} />
                        </button>
                      )}
                      <ChevronRight size={14} className="text-ink-300" />
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="px-4 py-3 text-center text-sm text-ink-500">
              未找到匹配的股票
            </div>
          )}
        </div>
      )}
    </div>
  );
}