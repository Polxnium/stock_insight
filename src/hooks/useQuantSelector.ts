/**
 * 量化选股Hook
 * 整合数据获取和分析逻辑
 */

import { useState, useCallback, useEffect } from 'react';
import { useAppStore } from '@/store';
import { fetchQuotes, fetchFundamental, fetchMoneyFlow, fetchFinReport, fetchKline } from '@/api';
import { analyzeStock, type SelectorStock } from '@/strategies/quantSelector';
import { isTradingTime } from '@/lib/marketTime';

/** 自适应轮询间隔：交易时段3分钟，盘前/盘后10分钟，其他30分钟 */
function getAdaptiveInterval(): number {
  const now = new Date();
  const chinaTime = new Date(now.getTime() + (now.getTimezoneOffset() + 8 * 60) * 60_000);
  const day = chinaTime.getUTCDay();
  const hour = chinaTime.getUTCHours();
  const minutes = hour * 60 + chinaTime.getUTCMinutes();

  // 周末不刷新
  if (day === 0 || day === 6) return 30 * 60 * 1000;

  // 交易时段 (9:25-11:30, 13:00-15:00): 3分钟
  if ((minutes >= 9 * 60 + 25 && minutes <= 11 * 60 + 30) ||
      (minutes >= 13 * 60 && minutes <= 15 * 60)) {
    return 3 * 60 * 1000;
  }

  // 盘前/盘后 (8:00-9:25, 15:00-17:00): 10分钟
  if ((minutes >= 8 * 60 && minutes < 9 * 60 + 25) ||
      (minutes > 15 * 60 && minutes <= 17 * 60)) {
    return 10 * 60 * 1000;
  }

  // 其他时间: 30分钟
  return 30 * 60 * 1000;
}

export function useQuantSelector() {
  const watchlist = useAppStore((s) => s.watchlist);
  const strategyWeights = useAppStore((s) => s.strategyWeights);
  const [stocks, setStocks] = useState<SelectorStock[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);

  const runAnalysis = useCallback(async () => {
    if (watchlist.length === 0) {
      setStocks([]);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const results: SelectorStock[] = [];

      for (const stock of watchlist) {
        try {
          // 并行获取各类数据
          const [quoteRes, fundamentalRes, moneyFlowRes, reportsRes, klineRes] = await Promise.all([
            fetchQuotes([stock.code]),
            fetchFundamental(stock.code),
            fetchMoneyFlow(stock.code),
            fetchFinReport(stock.code),
            fetchKline(stock.code, 60) // 获取60天K线数据
          ]);

          const quote = quoteRes.data?.[0] ?? null;
          const fundamental = fundamentalRes.data ?? null;
          const moneyFlow = moneyFlowRes.data ?? null;
          const reports = reportsRes.data ?? [];
          const klineData = klineRes.data ?? [];

          // 分析股票，优先使用行情数据中的真实股票名称
          const result = analyzeStock(
            stock.code,
            quote?.name || stock.alias || stock.code,
            quote,
            fundamental,
            moneyFlow,
            reports,
            klineData,
            strategyWeights
          );

          results.push(result);
        } catch {
          continue;
        }
      }

      // 按调整后得分排序
      results.sort((a, b) => b.adjustedScore - a.adjustedScore);
      
      // 设置排名
      results.forEach((stock, index) => {
        stock.rank = index + 1;
      });

      setStocks(results);
      setUpdatedAt(Date.now());
    } catch {
      setError('选股分析失败，请稍后重试');
    } finally {
      setLoading(false);
    }
  }, [watchlist, strategyWeights]);

  // 初始化和watchlist变化时重新分析
  useEffect(() => {
    const timer = setTimeout(() => {
      runAnalysis();
    }, 100);

    return () => clearTimeout(timer);
  }, [runAnalysis]);

  // 自适应定时刷新（交易时段3分钟，盘前/盘后10分钟，其他30分钟）
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;

    const scheduleNext = () => {
      const interval = getAdaptiveInterval();
      timer = setTimeout(() => {
        runAnalysis();
        scheduleNext();
      }, interval);
    };

    scheduleNext();

    return () => clearTimeout(timer);
  }, [runAnalysis]);

  return {
    stocks,
    loading,
    error,
    updatedAt,
    refresh: runAnalysis
  };
}