/**
 * 信号提醒组件
 * 显示选股信号提醒，支持 Toast 和列表展示
 */

import { useState } from 'react';
import { Bell, X, Check, AlertTriangle, TrendingUp, TrendingDown, Activity, BarChart3 } from 'lucide-react';
import type { Signal, SignalType } from '@/hooks/useSignalAlert';
import { cn } from '@/lib/format';

interface SignalAlertProps {
  signals: Signal[];
  unreadCount: number;
  onMarkRead: (id: string) => void;
  onClearAll: () => void;
}

/** 信号图标映射 */
const SIGNAL_ICONS: Record<SignalType, typeof TrendingUp> = {
  rsi_overbought: TrendingUp,
  rsi_oversold: TrendingDown,
  macd_golden: TrendingUp,
  macd_death: TrendingDown,
  limit_up: TrendingUp,
  limit_down: TrendingDown,
  volume_spike: Activity,
};

/** 信号颜色映射 */
const SIGNAL_COLORS: Record<SignalType, string> = {
  rsi_overbought: 'text-red-500 bg-red-50',
  rsi_oversold: 'text-green-500 bg-green-50',
  macd_golden: 'text-green-500 bg-green-50',
  macd_death: 'text-red-500 bg-red-50',
  limit_up: 'text-red-500 bg-red-50',
  limit_down: 'text-green-500 bg-green-50',
  volume_spike: 'text-blue-500 bg-blue-50',
};

export function SignalAlert({ signals, unreadCount, onMarkRead, onClearAll }: SignalAlertProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="relative">
      {/* 铃铛按钮 */}
      <button
        onClick={() => setExpanded(!expanded)}
        className={cn(
          'relative p-2 rounded-lg transition-colors',
          unreadCount > 0 ? 'bg-amber-100 text-amber-700' : 'bg-ink-100 text-ink-500 hover:bg-ink-200'
        )}
      >
        <Bell size={16} />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {/* 信号面板 */}
      {expanded && (
        <>
          {/* 背景遮罩 */}
          <div 
            className="fixed inset-0 z-40" 
            onClick={() => setExpanded(false)} 
          />
          
          {/* 面板 */}
          <div className="absolute right-0 top-full mt-2 w-80 bg-white rounded-lg shadow-lg border border-ink-200 z-50 max-h-96 overflow-hidden">
            {/* 头部 */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-ink-100">
              <span className="text-sm font-semibold text-ink-900">
                信号提醒 {unreadCount > 0 && `(${unreadCount})`}
              </span>
              {signals.length > 0 && (
                <button
                  onClick={onClearAll}
                  className="text-xs text-ink-400 hover:text-ink-600"
                >
                  清空全部
                </button>
              )}
            </div>

            {/* 信号列表 */}
            <div className="overflow-y-auto max-h-72">
              {signals.length === 0 ? (
                <div className="p-8 text-center">
                  <Bell size={24} className="mx-auto text-ink-300 mb-2" />
                  <p className="text-sm text-ink-400">暂无信号提醒</p>
                  <p className="text-xs text-ink-300 mt-1">系统会监控自选股的异常信号</p>
                </div>
              ) : (
                signals.map((signal) => {
                  const Icon = SIGNAL_ICONS[signal.type];
                  const colorClass = SIGNAL_COLORS[signal.type];
                  return (
                    <div
                      key={signal.id}
                      className={cn(
                        'flex items-start gap-3 px-4 py-3 border-b border-ink-50 hover:bg-ink-50 transition-colors',
                        !signal.read && 'bg-amber-50/50'
                      )}
                    >
                      <div className={cn('p-1.5 rounded-lg shrink-0', colorClass)}>
                        <Icon size={14} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-ink-800 truncate">{signal.message}</p>
                        <p className="text-[10px] text-ink-400 mt-0.5">
                          {new Date(signal.timestamp).toLocaleTimeString()}
                        </p>
                      </div>
                      {!signal.read && (
                        <button
                          onClick={() => onMarkRead(signal.id)}
                          className="p-1 text-ink-300 hover:text-ink-500 shrink-0"
                        >
                          <Check size={12} />
                        </button>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
