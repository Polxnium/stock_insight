// A 股交易时段判定（中国大陆时间）
// 开盘：周一~周五 9:30-11:30、13:00-15:00（不考虑节假日；节假日 = 数据不动而已，问题不大）

function chinaTimeParts(d = new Date()) {
  // 用 UTC 偏移 +8 计算，避免依赖系统时区
  const utc = d.getTime() + d.getTimezoneOffset() * 60_000;
  const cn = new Date(utc + 8 * 3600_000);
  return {
    day: cn.getUTCDay(), // 0=Sun..6=Sat
    hour: cn.getUTCHours(),
    minute: cn.getUTCMinutes(),
    minutes: cn.getUTCHours() * 60 + cn.getUTCMinutes(),
  };
}

export function isTradingTime(d = new Date()): boolean {
  const { day, minutes } = chinaTimeParts(d);
  if (day === 0 || day === 6) return false;
  // 9:25 起也算（集合竞价），更平滑
  if (minutes >= 9 * 60 + 25 && minutes <= 11 * 60 + 30) return true;
  if (minutes >= 13 * 60 && minutes <= 15 * 60) return true;
  return false;
}

/** 自适应轮询间隔（毫秒）：交易时段 fastMs，非交易时段 slowMs。 */
export function adaptiveInterval(fastMs: number, slowMs: number): number {
  return isTradingTime() ? fastMs : slowMs;
}
