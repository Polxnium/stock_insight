import { useEffect, useRef, useState, useCallback } from 'react';

/**
 * 通用轮询 hook —— 页面隐藏时自动暂停，回前台立即拉一次。
 * intervalMs 支持传函数，可在每次 tick 时动态决定（如交易时段 vs 收盘）。
 * 当 deps 变化时会立即触发一次数据刷新。
 * 支持竞态条件处理，确保只有最新请求的结果会更新状态。
 * 支持取消之前的请求，避免旧请求覆盖新数据。
 */
export function usePolling<T>(
  fetcher: () => Promise<T>,
  intervalMs: number | (() => number) = 5000,
  deps: unknown[] = [],
) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const timer = useRef<number | null>(null);
  const aliveRef = useRef(true);
  const requestIdRef = useRef(0);
  const abortControllerRef = useRef<AbortController | null>(null);
  
  // 使用 ref 保存最新的 fetcher 引用，避免闭包问题
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const getInterval = () =>
    typeof intervalMs === 'function' ? intervalMs() : intervalMs;

  const tick = useCallback(async () => {
    if (document.hidden) return;
    
    // 取消之前的请求
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    
    // 创建新的 abort controller
    const controller = new AbortController();
    abortControllerRef.current = controller;
    
    // 生成唯一请求ID，用于处理竞态条件
    const currentRequestId = ++requestIdRef.current;
    setLoading(true);
    
    try {
      // 使用 ref 获取最新的 fetcher，确保能访问最新的外部变量
      const d = await fetcherRef.current();
      
      // 检查是否是最新的请求，避免竞态条件
      if (aliveRef.current && requestIdRef.current === currentRequestId && !controller.signal.aborted) {
        setData(d);
        setUpdatedAt(Date.now());
        setError(null);
      }
    } catch (e) {
      // 忽略取消错误
      if (e instanceof Error && e.name === 'AbortError') {
        return;
      }
      if (aliveRef.current && requestIdRef.current === currentRequestId && !controller.signal.aborted) {
        setError(e as Error);
      }
    } finally {
      if (aliveRef.current && requestIdRef.current === currentRequestId && !controller.signal.aborted) {
        setLoading(false);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 当 deps 变化时立即触发刷新，并重置请求ID
  useEffect(() => {
    if (deps.length > 0) {
      // 立即清空旧数据，避免显示过期内容
      setData(null);
      // 重置请求ID，确保旧请求的结果不会覆盖新数据
      requestIdRef.current = 0;
      tick();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    aliveRef.current = true;
    let cancelled = false;

    const schedule = () => {
      if (cancelled) return;
      timer.current = window.setTimeout(async () => {
        await tick();
        schedule();
      }, getInterval());
    };

    // 初始加载
    tick().then(schedule);

    const onVis = () => !document.hidden && tick();
    document.addEventListener('visibilitychange', onVis);
    
    return () => {
      cancelled = true;
      aliveRef.current = false;
      // 取消正在进行的请求
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      if (timer.current) clearTimeout(timer.current);
      document.removeEventListener('visibilitychange', onVis);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick]);

  return { data, error, loading, updatedAt, refresh: tick };
}