import { useState, useEffect, useCallback } from 'react';
import { useAppStore } from '@/store';
import { fetchQuotes, fetchFundamental, fetchMoneyFlow, fetchFinReport, fetchKline } from '@/api';
import { analyzeStock, type SelectorStock } from '@/strategies/quantSelector';
import type { Quote, Fundamental, MoneyFlow, FinReport, KlineBar } from '@/types';

interface StockData {
  code: string;
  name: string;
  quote: Quote | null;
  fundamental: Fundamental | null;
  moneyFlow: MoneyFlow | null;
  reports: FinReport[];
  klineData: KlineBar[];
}

export function useStockSelector() {
  const [stocks, setStocks] = useState<SelectorStock[]>([]);
  const [loading, setLoading] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const watchlist = useAppStore((s) => s.watchlist);

  const fetchStockData = useCallback(async (code: string, name: string): Promise<StockData> => {
    const [quoteResult, fundamentalResult, moneyFlowResult, reportsResult, klineResult] = await Promise.all([
      fetchQuotes([code]).then(res => res.data[0] || null).catch(() => null),
      fetchFundamental(code).then(res => res.data).catch(() => null),
      fetchMoneyFlow(code).then(res => res.data).catch(() => null),
      fetchFinReport(code).then(res => res.data).catch(() => []),
      fetchKline(code, 60).then(res => res.data).catch(() => []),
    ]);

    return { code, name, quote: quoteResult, fundamental: fundamentalResult, moneyFlow: moneyFlowResult, reports: reportsResult, klineData: klineResult };
  }, []);

  const refresh = useCallback(async () => {
    if (watchlist.length === 0) {
      setStocks([]);
      setUpdatedAt(Date.now());
      return;
    }

    setLoading(true);

    try {
      const stockDataList: StockData[] = await Promise.all(
        watchlist.map(stockConfig => {
          const stockCode = stockConfig.code;
          const stockName = stockConfig.alias || '';
          return fetchStockData(stockCode, stockName);
        })
      );

      const analyzedStocks = stockDataList.map(data => {
        return analyzeStock(
          data.code,
          data.name,
          data.quote,
          data.fundamental,
          data.moneyFlow,
          data.reports,
          data.klineData
        );
      });

      analyzedStocks.sort((a, b) => b.adjustedScore - a.adjustedScore);
      analyzedStocks.forEach((stock, index) => {
        stock.rank = index + 1;
      });

      setStocks(analyzedStocks);
    } catch (error) {
      console.error('选股分析失败:', error);
    } finally {
      setLoading(false);
      setUpdatedAt(Date.now());
    }
  }, [watchlist, fetchStockData]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { stocks, loading, updatedAt, refresh };
}