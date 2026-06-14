// 大盘指数（新浪行情接口）
// gb_ 前缀 = 新浪海外指数
// hf_ 前缀 = 新浪全球期指（含日经期指）
export interface IndexConfig {
  code:      string;
  name:      string;
  /** 此项前插入竖线分隔符（用于区分境内 / 境外） */
  divider?:  boolean;
}

export const INDICES: IndexConfig[] = [
  // ── 境内 ──────────────────────────────────────
  { code: 'sh000001', name: '上证' },
  { code: 'sz399001', name: '深证成指' },
  { code: 'sz399006', name: '创业板' },
  { code: 'sh000300', name: '沪深300' },
  // ── 境外（新浪 gb_ 系列） ─────────────────────
  { code: 'gb_dji',   name: '道琼斯',   divider: true },
  { code: 'gb_ixic',  name: '纳斯达克' },
  { code: 'gb_inx',   name: '标普500' },
];