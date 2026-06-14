import { useState, useEffect, useMemo } from 'react';
import { TrendingUp, TrendingDown, ArrowUpCircle, DollarSign, Plus, Flame } from 'lucide-react';
import { fetchHotStocks } from '@/api';
import { useAppStore } from '@/store';
import { cn, colorClass, fmtPrice, fmtPct } from '@/lib/format';

interface HotStock {
  code: string;
  name: string;
  price: number;
  changePct: number;
  turnover?: number;
  volume?: number;
}

type TabType = 'up' | 'down' | 'hot';

// 模拟热门股票数据（作为API失败时的fallback）
const DEFAULT_HOT_STOCKS: HotStock[] = [
  { code: 'sh600519', name: '贵州茅台', price: 1688.00, changePct: 2.35, turnover: 15.2, volume: 89200 },
  { code: 'sh601318', name: '中国平安', price: 48.20, changePct: -1.25, turnover: 18.5, volume: 383600 },
  { code: 'sz000858', name: '五粮液', price: 145.60, changePct: 1.85, turnover: 12.3, volume: 84500 },
  { code: 'sh600036', name: '招商银行', price: 32.80, changePct: 0.95, turnover: 8.7, volume: 266800 },
  { code: 'sz002594', name: '比亚迪', price: 268.00, changePct: 4.56, turnover: 52.1, volume: 194300 },
  { code: 'sh601012', name: '隆基绿能', price: 24.50, changePct: -2.15, turnover: 15.8, volume: 647000 },
  { code: 'sh601398', name: '工商银行', price: 5.12, changePct: 0.39, turnover: 5.8, volume: 1125000 },
  { code: 'sh600030', name: '中信证券', price: 21.35, changePct: 1.68, turnover: 18.2, volume: 867000 },
  { code: 'sh601668', name: '中国建筑', price: 5.88, changePct: 0.86, turnover: 6.2, volume: 523000 },
  { code: 'sz000001', name: '平安银行', price: 12.45, changePct: -0.72, turnover: 9.5, volume: 418000 },
  { code: 'sh600000', name: '浦发银行', price: 7.85, changePct: 0.38, turnover: 4.2, volume: 268000 },
  { code: 'sh601939', name: '建设银行', price: 6.52, changePct: 0.46, turnover: 7.1, volume: 445000 },
  { code: 'sz000333', name: '美的集团', price: 58.60, changePct: 1.25, turnover: 14.8, volume: 252000 },
  { code: 'sh600887', name: '伊利股份', price: 28.35, changePct: 0.92, turnover: 8.5, volume: 301000 },
  { code: 'sh600690', name: '海尔智家', price: 25.80, changePct: 1.15, turnover: 11.2, volume: 435000 },
  { code: 'sz000651', name: '格力电器', price: 42.50, changePct: 0.71, turnover: 10.8, volume: 256000 },
  { code: 'sh601166', name: '兴业银行', price: 15.20, changePct: 0.53, turnover: 6.8, volume: 422000 },
  { code: 'sh600104', name: '上汽集团', price: 16.80, changePct: -1.12, turnover: 7.5, volume: 468000 },
  { code: 'sh601899', name: '紫金矿业', price: 15.60, changePct: 2.18, turnover: 22.5, volume: 1480000 },
  { code: 'sh600028', name: '中国石化', price: 4.85, changePct: -0.41, turnover: 3.8, volume: 785000 },
];

// 过滤掉 ST、创业板(300开头)、科创板(688开头)股票
function filterStock(stock: HotStock): boolean {
  // 过滤 ST 股票
  if (stock.name.includes('ST') || stock.name.includes('*ST')) {
    return false;
  }
  // 过滤创业板（300开头）
  if (stock.code.startsWith('sz300')) {
    return false;
  }
  // 过滤科创板（688开头）
  if (stock.code.startsWith('sh688')) {
    return false;
  }
  return true;
}

export function HotStocks() {
  const [activeTab, setActiveTab] = useState<TabType>('hot');
  const [hotStocks, setHotStocks] = useState<HotStock[]>(DEFAULT_HOT_STOCKS);
  const [loading, setLoading] = useState(false);
  const [lastUpdate, setLastUpdate] = useState(0);

  const addStock = useAppStore((s) => s.addStock);
  const setSelectedCode = useAppStore((s) => s.setSelectedCode);
  const watchlist = useAppStore((s) => s.watchlist);

  // 过滤后的股票列表
  const filteredStocks = useMemo(() => {
    return hotStocks.filter(filterStock);
  }, [hotStocks]);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        const res = await fetchHotStocks(100);
        const data = res.data || [];
        if (data.length > 0) {
          setHotStocks(data);
          setLastUpdate(Date.now());
        }
      } catch {
        // API失败时使用默认数据
      } finally {
        setLoading(false);
      }
    };

    fetchData();
    const interval = setInterval(fetchData, 60000);
    return () => clearInterval(interval);
  }, []);

  const displayStocks = useMemo(() => {
    if (activeTab === 'up') {
      return [...filteredStocks].sort((a, b) => b.changePct - a.changePct).slice(0, 8);
    } else if (activeTab === 'down') {
      return [...filteredStocks].sort((a, b) => a.changePct - b.changePct).slice(0, 8);
    } else {
      return filteredStocks.slice(0, 8);
    }
  }, [activeTab, filteredStocks]);

  const isInWatchlist = (code: string) => {
    return watchlist.some(w => w.code === code);
  };

  const handleAdd = (e: React.MouseEvent, code: string, name: string) => {
    e.stopPropagation();
    addStock({ code, alias: name });
  };

  const handleSelect = (code: string) => {
    setSelectedCode(code);
  };

  const tabs = [
    { id: 'hot' as TabType, label: '热门榜', icon: Flame },
    { id: 'up' as TabType, label: '涨幅榜', icon: TrendingUp },
    { id: 'down' as TabType, label: '跌幅榜', icon: TrendingDown },
  ];

  return (
    <div className="rounded-lg border border-ink-200 bg-white">
      <div className="flex items-center justify-between border-b border-ink-100 px-3">
        <div className="flex items-center gap-2">
          <Flame size={12} className="text-orange-500" />
          <span className="text-xs font-semibold">同花顺热度 TOP 100</span>
        </div>
        <span className="text-[10px] text-ink-400">
          {new Date(lastUpdate).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>

      <div className="flex items-center border-b border-ink-100">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors',
                isActive
                  ? 'text-ink-900 border-b-2 border-ink-900 bg-ink-50'
                  : 'text-ink-500 hover:text-ink-700 hover:bg-ink-50'
              )}
            >
              <Icon size={11} />
              {tab.label}
            </button>
          );
        })}
      </div>

      <div className="p-2 max-h-64 overflow-y-auto">
        {loading ? (
          <div className="py-4 text-center text-xs text-ink-400">加载中...</div>
        ) : displayStocks.length === 0 ? (
          <div className="py-4 text-center text-xs text-ink-400">暂无数据</div>
        ) : (
          <ul className="space-y-0.5">
            {displayStocks.map((stock, index) => {
              const inWatchlist = isInWatchlist(stock.code);
              return (
                <li
                  key={stock.code}
                  onClick={() => handleSelect(stock.code)}
                  className="group flex items-center justify-between px-2 py-1.5 rounded hover:bg-ink-50 cursor-pointer transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <span className={cn(
                      'w-4 h-4 flex items-center justify-center rounded text-[9px] font-bold',
                      index === 0 ? 'bg-red-500 text-white' :
                      index === 1 ? 'bg-orange-400 text-white' :
                      index === 2 ? 'bg-yellow-400 text-white' :
                      'bg-ink-100 text-ink-500'
                    )}>
                      {index + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-medium truncate">
                        {stock.name}
                      </div>
                      <div className="text-[9px] text-ink-400">{stock.code}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="tabular text-xs">{fmtPrice(stock.price)}</span>
                    <span className={cn('tabular text-xs font-medium', colorClass(stock.changePct))}>
                      {stock.changePct >= 0 ? '+' : ''}{stock.changePct.toFixed(2)}%
                    </span>
                    {!inWatchlist && (
                      <button
                        onClick={(e) => handleAdd(e, stock.code, stock.name)}
                        className="p-0.5 rounded text-ink-300 hover:text-green-600 hover:bg-green-50 opacity-0 group-hover:opacity-100 transition-all"
                        title="添加到自选"
                      >
                        <Plus size={10} />
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="border-t border-ink-100 px-3 py-1.5">
        <button
          onClick={() => setActiveTab('hot')}
          className="flex items-center justify-center gap-1 w-full text-[10px] text-ink-400 hover:text-ink-600"
        >
          <ArrowUpCircle size={10} />
          查看完整榜单
        </button>
      </div>
    </div>
  );
}