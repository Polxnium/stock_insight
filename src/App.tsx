import { useState } from 'react';
import { TrendingUp, BarChart3, Search, Flame, Sparkles, Wallet, Target, Users, Globe, Zap, ScrollText, ChevronsLeft, ChevronsRight } from 'lucide-react';
import { IndexBar } from '@/components/IndexBar';
import { WatchList } from '@/components/WatchList';
import { PositionList } from '@/components/PositionList';
import { NewsFeed } from '@/components/NewsFeed';
import { StockAnalysis, AnnouncementPanel } from '@/components/StockAnalysis';
import { cn } from '@/lib/format';
import { ModelPicker } from '@/components/ModelPicker';
import { QuantSelectorPage } from '@/components/QuantSelectorPage';
import { StockSelectorPage } from '@/components/StockFilter/index';
import { StockSearch } from '@/components/StockSearch';
import { HotStocks } from '@/components/HotStocks';
import { StockRecommend } from '@/components/StockRecommend';
import { SignalAlert } from '@/components/SignalAlert';
import { useQuantSelector } from '@/hooks/useQuantSelector';
import { useSignalAlert } from '@/hooks/useSignalAlert';

type TabType = 'main' | 'quant';
type QuantMode = 'watchlist' | 'market';
type SidebarTab = 'watchlist' | 'positions' | 'discover';

export default function App() {
  const [showNews, setShowNews] = useState(true);
  const [activeTab, setActiveTab] = useState<TabType>('main');
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>('positions');
  const [rightTab, setRightTab] = useState<'news' | 'ann'>('news');
  const [quantMode, setQuantMode] = useState<QuantMode>('watchlist');
  const { stocks: selectedStocks, loading: selectorLoading, updatedAt: selectorUpdatedAt, refresh: refreshSelector } = useQuantSelector();
  const { signals, unreadCount, markAsRead, clearAll } = useSignalAlert();

  const tabs = [
    { id: 'main' as TabType, label: '主页', icon: BarChart3 },
    { id: 'quant' as TabType, label: '量化', icon: TrendingUp },
  ];

  const sidebarTabs = [
    { id: 'positions' as SidebarTab, label: '持仓股', icon: Wallet },
    { id: 'watchlist' as SidebarTab, label: '自选股', icon: BarChart3 },
    { id: 'discover' as SidebarTab, label: '发现', icon: Search },
  ];

  return (
    <div className="min-h-screen bg-ink-50 text-ink-900">
      {/* Header */}
      <header className="sticky top-0 z-10 border-b border-ink-200 bg-white/80 backdrop-blur">
          <div className="flex items-center justify-between px-6 py-3">
          <div className="flex items-center gap-3">
            <div className="h-2 w-2 rounded-full bg-ink-900" />
            <h1 className="text-sm font-semibold tracking-wide">Insight</h1>
            <span className="text-xs text-ink-400">星与青山盟</span>
          </div>
          <div className="flex items-center gap-3">
            <SignalAlert 
              signals={signals} 
              unreadCount={unreadCount} 
              onMarkRead={markAsRead} 
              onClearAll={clearAll} 
            />
            <ModelPicker />
          </div>
        </div>
        <IndexBar />
        
        {/* Tab 切换 */}
        <div className="flex border-t border-ink-100">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-4 py-2 text-xs font-medium transition-colors ${
                  isActive
                    ? 'text-ink-900 border-b-2 border-ink-900 bg-white'
                    : 'text-ink-500 hover:text-ink-700 hover:bg-ink-50'
                }`}
              >
                <Icon size={14} />
                {tab.label}
              </button>
            );
          })}
        </div>
      </header>

      {/* Main：flex 布局 */}
      <main className="flex items-stretch gap-4 p-4">
        {/* 侧边栏 */}
        {activeTab === 'main' && (
          <aside className="w-72 shrink-0 flex flex-col gap-4">
            {/* 侧边栏 Tab 切换 */}
            <div className="flex rounded-lg border border-ink-200 bg-white overflow-hidden">
              {sidebarTabs.map((tab) => {
                const Icon = tab.icon;
                const isActive = sidebarTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setSidebarTab(tab.id)}
                    className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors ${
                      isActive
                        ? 'text-ink-900 bg-ink-50'
                        : 'text-ink-500 hover:text-ink-700 hover:bg-ink-50'
                    }`}
                  >
                    <Icon size={12} />
                    {tab.label}
                  </button>
                );
              })}
            </div>

            {sidebarTab === 'watchlist' ? (
              <WatchList />
            ) : sidebarTab === 'positions' ? (
              <PositionList />
            ) : (
              <div className="flex-1 space-y-4 overflow-y-auto">
                {/* 股票搜索 */}
                <div className="rounded-lg border border-ink-200 bg-white p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <Search size={12} className="text-ink-400" />
                    <span className="text-xs font-semibold">搜索股票</span>
                  </div>
                  <StockSearch />
                </div>

                {/* 热门股票 */}
                <HotStocks />

                {/* 智能推荐 */}
                <StockRecommend />
              </div>
            )}
          </aside>
        )}
        
        {/* 主内容区 */}
        {activeTab === 'main' ? (
          <>
            <section className="min-w-0 flex-1">
              <StockAnalysis />
            </section>
            <aside className={`shrink-0 transition-[width] duration-300 ${showNews ? 'w-72' : 'w-10'}`}>
              {showNews ? (
                <div className="flex h-[715px] flex-col rounded-lg border border-ink-200 bg-white">
                  {/* 顶部 Tab 切换 */}
                  <div className="flex shrink-0 items-center justify-between border-b border-ink-100 px-3 py-1.5">
                    <div className="flex gap-0.5">
                      {[
                        { key: 'news' as const, label: '财经快讯', icon: Zap },
                        { key: 'ann'  as const, label: '近期公告', icon: ScrollText },
                      ].map(({ key, label, icon: Icon }) => (
                        <button
                          key={key}
                          onClick={() => setRightTab(key)}
                          className={cn(
                            'flex items-center gap-1 rounded px-2.5 py-1 text-[10px] font-medium transition-colors',
                            rightTab === key
                              ? 'bg-ink-900 text-white'
                              : 'text-ink-500 hover:bg-ink-100 hover:text-ink-700',
                          )}
                        >
                          <Icon size={11} />
                          {label}
                        </button>
                      ))}
                    </div>
                    <button
                      onClick={() => setShowNews(false)}
                      title="收起"
                      className="rounded-md bg-ink-50 p-1.5 text-ink-500 transition-all hover:bg-ink-900 hover:text-white hover:shadow-sm"
                    >
                      <ChevronsRight size={16} />
                    </button>
                  </div>
                  {/* 内容区 */}
                  <div className="flex-1 overflow-hidden">
                    {rightTab === 'news' ? <NewsFeed /> : <AnnouncementPanel />}
                  </div>
                </div>
              ) : (
                <div className="flex h-full min-h-[200px] flex-col items-center justify-center rounded-lg border border-ink-200 bg-gradient-to-b from-white to-ink-50">
                  <button
                    onClick={() => setShowNews(true)}
                    title="展开资讯"
                    className="group flex flex-col items-center gap-3 rounded-lg px-2 py-4 transition-all hover:bg-white hover:shadow-sm"
                  >
                    <ChevronsLeft size={18} className="text-ink-400 transition-transform group-hover:scale-110 group-hover:text-ink-700" />
                    <span
                      className="text-[11px] font-medium text-ink-500 select-none group-hover:text-ink-800"
                      style={{ writingMode: 'vertical-rl', textOrientation: 'mixed' }}
                    >
                      资讯
                    </span>
                  </button>
                </div>
              )}
            </aside>
          </>
        ) : (
          <section className="min-w-0 flex-[2] space-y-4">
            {/* 量化选股模式切换 */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => setQuantMode('watchlist')}
                className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                  quantMode === 'watchlist'
                    ? 'bg-ink-900 text-white'
                    : 'bg-white border border-ink-200 text-ink-600 hover:bg-ink-50'
                }`}
              >
                <Users size={14} />
                自选股分析
              </button>
              <button
                onClick={() => setQuantMode('market')}
                className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                  quantMode === 'market'
                    ? 'bg-ink-900 text-white'
                    : 'bg-white border border-ink-200 text-ink-600 hover:bg-ink-50'
                }`}
              >
                <Globe size={14} />
                全市场扫描
              </button>
            </div>

            {/* 根据模式显示不同内容 */}
            {quantMode === 'watchlist' ? (
              <QuantSelectorPage 
                stocks={selectedStocks} 
                loading={selectorLoading}
                updatedAt={selectorUpdatedAt}
                onRefresh={refreshSelector}
              />
            ) : (
              <StockSelectorPage />
            )}
          </section>
        )}
      </main>

      <footer className="py-6 text-center text-xs text-ink-400">
        数据源：新浪财经 / 东方财富 · 本站仅供研究，不构成投资建议
      </footer>
    </div>
  );
}