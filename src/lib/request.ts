import type { ApiEnvelope } from '@/types';

/** 返回 data + 服务端时间戳。失败抛错。 */
export async function apiEnv<T>(
  path: string,
  init?: RequestInit,
): Promise<{ data: T; ts: number }> {
  const r = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
  });
  const j: ApiEnvelope<T> = await r.json();
  if (!j.ok) throw new Error(j.error || `请求失败 ${r.status}`);
  return { data: j.data as T, ts: j.ts ?? Date.now() };
}

/** 仅取 data 的便捷版。 */
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const { data } = await apiEnv<T>(path, init);
  return data;
}
