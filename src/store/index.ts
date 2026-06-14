import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { DEFAULT_WATCHLIST, type StockConfig } from '@/config/stocks';
import { DEFAULT_MODEL_ID } from '@/config/llm';
import type { DimensionWeights } from '@/strategies/scoring';

// 持仓股配置
interface PositionConfig {
  code: string; // 新浪格式，如 sh600519
  alias?: string; // 自定义备注名
  tags?: string[]; // 属性标签
}

interface AppState {
  watchlist: StockConfig[];
  addStock: (s: StockConfig) => void;
  removeStock: (code: string) => void;
  updateStockTags: (code: string, tags: string[]) => void;

  positions: PositionConfig[];
  addPosition: (p: PositionConfig) => void;
  removePosition: (code: string) => void;
  updatePositionTags: (code: string, tags: string[]) => void;

  selectedCode: string | null;
  setSelectedCode: (code: string | null) => void;

  modelId: string;
  setModelId: (id: string) => void;

  strategyWeights: DimensionWeights;
  setStrategyWeights: (weights: DimensionWeights) => void;

  stealthMode: boolean; // 摸鱼模式预留位
  toggleStealth: () => void;
}

// 默认持仓股数据
const DEFAULT_POSITIONS: PositionConfig[] = [
  { code: 'sh600519', alias: '贵州茅台' },
  { code: 'sh601318', alias: '中国平安' },
  { code: 'sz000858', alias: '五粮液' },
];

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      watchlist: DEFAULT_WATCHLIST,
      addStock: (s) =>
        set((state) =>
          state.watchlist.some((x) => x.code === s.code)
            ? state
            : { watchlist: [...state.watchlist, s] },
        ),
      removeStock: (code) =>
        set((state) => ({
          watchlist: state.watchlist.filter((x) => x.code !== code),
        })),
      updateStockTags: (code, tags) =>
        set((state) => ({
          watchlist: state.watchlist.map((x) =>
            x.code === code ? { ...x, tags } : x
          ),
        })),

      positions: DEFAULT_POSITIONS,
      addPosition: (p) =>
        set((state) =>
          state.positions.some((x) => x.code === p.code)
            ? state
            : { positions: [...state.positions, p] },
        ),
      removePosition: (code) =>
        set((state) => ({
          positions: state.positions.filter((x) => x.code !== code),
        })),
      updatePositionTags: (code, tags) =>
        set((state) => ({
          positions: state.positions.map((x) =>
            x.code === code ? { ...x, tags } : x
          ),
        })),

      selectedCode: null,
      setSelectedCode: (code) => set({ selectedCode: code }),

      modelId: DEFAULT_MODEL_ID,
      setModelId: (id) => set({ modelId: id }),

      strategyWeights: { fundamental: 35, technical: 35, money: 30 },
      setStrategyWeights: (weights) => set({ strategyWeights: weights }),

      stealthMode: false,
      toggleStealth: () => set((s) => ({ stealthMode: !s.stealthMode })),
    }),
    { name: 'stock-insight-store' },
  ),
);