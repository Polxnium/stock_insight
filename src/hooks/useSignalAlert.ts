/**
 * 信号提醒 Hook
 * 监控自选股的技术指标和行情变化，触发提醒
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useAppStore } from '@/store';
import { fetchQuotes } from '@/api';
import { fetchKline } from '@/api';
import type { KlineBar, Quote } from '@/types';

/** 信号类型 */
export type SignalType = 'rsi_overbought' | 'rsi_oversold' | 'macd_golden' | 'macd_death' | 'limit_up' | 'limit_down' | 'volume_spike';

/** 信号项 */
export interface Signal {
  id: string;
  code: string;
  name: string;
  type: SignalType;
  message: string;
  timestamp: number;
  read: boolean;
}

/** 信号描述映射 */
const SIGNAL_LABELS: Record<SignalType, string> = {
  rsi_overbought: 'RSI超买',
  rsi_oversold: 'RSI超卖',
  macd_golden: 'MACD金叉',
  macd_death: 'MACD死叉',
  limit_up: '涨停',
  limit_down: '跌停',
  volume_spike: '成交量异动',
};

/** 计算RSI */
function calcRSI(closes: number[], period = 14): number | null {
  if (closes.length < period + 1) return null;
  const changes: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    changes.push(closes[i] - closes[i - 1]);
  }
  const recent = changes.slice(-period);
  const gains = recent.filter(c => c > 0);
  const losses = recent.filter(c => c < 0);
  const avgGain = gains.length > 0 ? gains.reduce((s, v) => s + v, 0) / period : 0;
  const avgLoss = losses.length > 0 ? Math.abs(losses.reduce((s, v) => s + v, 0)) / period : 0;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

/** 计算MACD */
function calcMACD(closes: number[]): { macd: number; signal: number; histogram: number } | null {
  if (closes.length < 26) return null;
  const ema = (data: number[], period: number) => {
    const k = 2 / (period + 1);
    let result = data[0];
    for (let i = 1; i < data.length; i++) {
      result = data[i] * k + result * (1 - k);
    }
    return result;
  };
  const ema12 = ema(closes, 12);
  const ema26 = ema(closes, 26);
  const macd = ema12 - ema26;
  // 简化signal计算
  const macdLine: number[] = [];
  let e12 = closes[0], e26 = closes[0];
  for (let i = 1; i < closes.length; i++) {
    e12 = closes[i] * (2 / 13) + e12 * (1 - 2 / 13);
    e26 = closes[i] * (2 / 27) + e26 * (1 - 2 / 27);
    macdLine.push(e12 - e26);
  }
  const signal = ema(macdLine.slice(-9), 9);
  return { macd, signal, histogram: macd - signal };
}

/** 检查单只股票的信号 */
function checkSignals(quote: Quote, klineData: KlineBar[], prevKlineData?: KlineBar[]): Signal[] {
  const signals: Signal[] = [];
  const closes = klineData.map(k => k.close);
  
  // RSI检查
  const rsi = calcRSI(closes);
  if (rsi !== null) {
    if (rsi > 80) {
      signals.push({
        id: `${quote.code}-rsi_overbought-${Date.now()}`,
        code: quote.code,
        name: quote.name || quote.code,
        type: 'rsi_overbought',
        message: `${quote.name} RSI=${rsi.toFixed(1)}，超买警告`,
        timestamp: Date.now(),
        read: false,
      });
    } else if (rsi < 20) {
      signals.push({
        id: `${quote.code}-rsi_oversold-${Date.now()}`,
        code: quote.code,
        name: quote.name || quote.code,
        type: 'rsi_oversold',
        message: `${quote.name} RSI=${rsi.toFixed(1)}，超卖机会`,
        timestamp: Date.now(),
        read: false,
      });
    }
  }

  // MACD检查（需要前后两次数据对比）
  const currentMACD = calcMACD(closes);
  if (prevKlineData && currentMACD) {
    const prevCloses = prevKlineData.map(k => k.close);
    const prevMACD = calcMACD(prevCloses);
    if (prevMACD) {
      // 金叉: MACD从负变正
      if (prevMACD.histogram < 0 && currentMACD.histogram > 0) {
        signals.push({
          id: `${quote.code}-macd_golden-${Date.now()}`,
          code: quote.code,
          name: quote.name || quote.code,
          type: 'macd_golden',
          message: `${quote.name} MACD金叉，买入信号`,
          timestamp: Date.now(),
          read: false,
        });
      }
      // 死叉: MACD从正变负
      else if (prevMACD.histogram > 0 && currentMACD.histogram < 0) {
        signals.push({
          id: `${quote.code}-macd_death-${Date.now()}`,
          code: quote.code,
          name: quote.name || quote.code,
          type: 'macd_death',
          message: `${quote.name} MACD死叉，卖出信号`,
          timestamp: Date.now(),
          read: false,
        });
      }
    }
  }

  // 涨停/跌停检查
  if (quote.changePct >= 9.9) {
    signals.push({
      id: `${quote.code}-limit_up-${Date.now()}`,
      code: quote.code,
      name: quote.name || quote.code,
      type: 'limit_up',
      message: `${quote.name} 涨停 +${quote.changePct.toFixed(2)}%`,
      timestamp: Date.now(),
      read: false,
    });
  } else if (quote.changePct <= -9.9) {
    signals.push({
      id: `${quote.code}-limit_down-${Date.now()}`,
      code: quote.code,
      name: quote.name || quote.code,
      type: 'limit_down',
      message: `${quote.name} 跌停 ${quote.changePct.toFixed(2)}%`,
      timestamp: Date.now(),
      read: false,
    });
  }

  // 成交量异动（今日成交量超过5日均量2倍）
  if (klineData.length >= 6) {
    const recent = klineData.slice(-6, -1);
    const avgVolume = recent.reduce((s, k) => s + k.volume, 0) / recent.length;
    const currentVolume = klineData[klineData.length - 1].volume;
    if (currentVolume > avgVolume * 2.5 && avgVolume > 0) {
      signals.push({
        id: `${quote.code}-volume_spike-${Date.now()}`,
        code: quote.code,
        name: quote.name || quote.code,
        type: 'volume_spike',
        message: `${quote.name} 成交量异动，较5日均量放大${(currentVolume / avgVolume).toFixed(1)}倍`,
        timestamp: Date.now(),
        read: false,
      });
    }
  }

  return signals;
}

export function useSignalAlert() {
  const watchlist = useAppStore((s) => s.watchlist);
  const [signals, setSignals] = useState<Signal[]>([]);
  const prevKlineRef = useRef<Map<string, KlineBar[]>>(new Map());
  const lastCheckRef = useRef<number>(0);

  const checkAllSignals = useCallback(async () => {
    if (watchlist.length === 0) return;
    
    // 防止过于频繁检查（至少间隔30秒）
    if (Date.now() - lastCheckRef.current < 30000) return;
    lastCheckRef.current = Date.now();

    try {
      const quotesRes = await fetchQuotes(watchlist.map(w => w.code));
      const quotes = quotesRes.data;

      const newSignals: Signal[] = [];

      for (const quote of quotes) {
        if (!quote) continue;
        try {
          const klineRes = await fetchKline(quote.code, 30);
          const klineData = klineRes.data || [];
          const prevKline = prevKlineRef.current.get(quote.code);

          const stockSignals = checkSignals(quote, klineData, prevKline);
          newSignals.push(...stockSignals);

          // 更新历史K线缓存
          prevKlineRef.current.set(quote.code, klineData);
        } catch {
          continue;
        }
      }

      // 过滤已存在的信号（避免重复提醒）
      const existingIds = new Set(signals.map(s => `${s.code}-${s.type}`));
      const uniqueSignals = newSignals.filter(s => !existingIds.has(`${s.code}-${s.type}`));

      if (uniqueSignals.length > 0) {
        setSignals(prev => [...uniqueSignals, ...prev].slice(0, 50)); // 最多保留50条
        
        // 浏览器通知
        if ('Notification' in window && Notification.permission === 'granted') {
          for (const sig of uniqueSignals.slice(0, 3)) {
            new Notification(`📊 ${SIGNAL_LABELS[sig.type]}`, {
              body: sig.message,
              icon: '/favicon.ico',
            });
          }
        }
      }
    } catch {
      // 静默失败
    }
  }, [watchlist, signals]);

  // 请求通知权限
  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, []);

  // 定期检查信号（每5分钟）
  useEffect(() => {
    const timer = setTimeout(() => checkAllSignals(), 2000); // 延迟2秒开始
    const interval = setInterval(checkAllSignals, 5 * 60 * 1000);
    return () => {
      clearTimeout(timer);
      clearInterval(interval);
    };
  }, [checkAllSignals]);

  const markAsRead = (id: string) => {
    setSignals(prev => prev.map(s => s.id === id ? { ...s, read: true } : s));
  };

  const clearAll = () => {
    setSignals([]);
  };

  const unreadCount = signals.filter(s => !s.read).length;

  return {
    signals,
    unreadCount,
    markAsRead,
    clearAll,
    checkNow: checkAllSignals,
  };
}
