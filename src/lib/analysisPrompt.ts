/**
 * analysisPrompt.ts — AI 分析 Prompt 构建模块
 *
 * 职责：
 *   1. 把多源数据（行情/基本面/技术面/资金面/消息面/公告面）组装成结构化文本
 *   2. 定义系统 Prompt，约束模型输出合规 JSON
 *   3. 提供 JSON 解析（含容错）和失败时的修复 Prompt
 *
 * 不关心：数据从哪里来、谁调用 API、UI 怎么展示
 */

import type { Announcement, Fundamental, KlineBar, MoneyFlow, NewsItem, Quote } from '@/types';
import { summarizeTechnicals } from './indicators';
import { fmtAmount } from './format';

// ============================================================
// 输入类型
// ============================================================

export interface PromptInputs {
  quote:         Quote;
  fundamental:   Fundamental | null;
  moneyflow:     MoneyFlow | null;
  klines:        KlineBar[];         // 日 K，从旧到新
  announcements: Announcement[];
  relatedNews:   NewsItem[];
}

// ============================================================
// 系统 Prompt（约束模型行为）
// ============================================================

const SYSTEM_PROMPT = `你是一位严谨、克制的 A 股研究员。基于用户给出的"事实数据"，从以下六个维度做综合分析：
  行情面、基本面、技术面、资金面、消息面、公告面

规则（严格遵守，否则输出无效）：
1. 只能基于给出的数据进行逻辑推理，严禁虚构任何数字或事件。
2. 若某维度数据标注"数据不足"，该维度评分不得高于 5，并需在分析中说明原因。
3. 评分使用 0–10 整数：0=极度负面，5=中性，10=极度正面。
4. 输出必须是合法 JSON，不能有任何 markdown 代码块、注释、多余文字。

JSON 结构（所有字段必填，数组至少 1 项）：
{
  "scores": {
    "基本面": <0-10>,
    "技术面": <0-10>,
    "资金面": <0-10>,
    "消息面": <0-10>
  },
  "conclusion": "<60字以内综合结论>",
  "bullish":    ["<看多理由1>", "..."],
  "bearish":    ["<看空理由1>", "..."],
  "risks":      ["<风险点1>",   "..."],
  "suggestion": "<一句话操作建议，必须含'仅供参考，不构成投资建议'>"
}`;

// ============================================================
// 数据格式化辅助（只在本模块使用，保持函数简短）
// ============================================================

const n = (v: number | null | undefined, d = 2, suffix = ''): string =>
  v == null || !Number.isFinite(v) ? '—' : `${v.toFixed(d)}${suffix}`;

const yi = (v: number | null | undefined): string =>
  v == null || !Number.isFinite(v) ? '—' : `${(v / 1e8).toFixed(2)}亿`;

const wan = (v: number | null | undefined): string =>
  v == null || !Number.isFinite(v) ? '—' : `${(v / 1e4).toFixed(0)}万`;

// ============================================================
// Prompt 各维度块构建（每块独立函数，便于单独维护）
// ============================================================

function buildQuoteBlock(q: Quote): string {
  return [
    `【行情面】  数据时间：${q.date} ${q.time}`,
    `  现价 ${q.price}，涨跌幅 ${q.changePct.toFixed(2)}%（涨跌额 ${q.change >= 0 ? '+' : ''}${q.change.toFixed(2)}）`,
    `  今开 ${q.open} / 昨收 ${q.prevClose} / 最高 ${q.high} / 最低 ${q.low}`,
    `  成交额 ${fmtAmount(q.amount)}`,
  ].join('\n');
}

function buildFundamentalBlock(f: Fundamental | null): string {
  if (!f) return '【基本面】\n  数据不足';
  return [
    '【基本面】',
    `  PE(TTM) ${n(f.peTTM)} / PE(动) ${n(f.peDyn)} / PB ${n(f.pb)}`,
    `  ROE ${n(f.roe, 2, '%')} / 每股收益 ${n(f.eps)} 元`,
    `  总市值 ${yi(f.totalMarketCap)} / 流通市值 ${yi(f.floatMarketCap)}`,
    `  换手率 ${n(f.turnover, 2, '%')} / 量比 ${n(f.volumeRatio)}`,
  ].join('\n');
}

function buildTechnicalBlock(klines: KlineBar[]): string {
  if (klines.length < 10) return '【技术面】\n  数据不足（K线根数不足）';
  return ['【技术面（前复权日K，近60日）】', summarizeTechnicals(klines)].join('\n');
}

function buildMoneyFlowBlock(m: MoneyFlow | null): string {
  if (!m) return '【资金面】\n  数据不足';
  return [
    '【资金面（今日）】',
    `  主力净流入 ${wan(m.mainNet)}（占比 ${n(m.mainPct, 2, '%')}）`,
    `  超大单 ${wan(m.superLargeNet)}（${n(m.superLargePct, 2, '%')}） / 大单 ${wan(m.largeNet)}（${n(m.largePct, 2, '%')}）`,
    `  中单 ${wan(m.mediumNet)}（${n(m.mediumPct, 2, '%')}） / 小单 ${wan(m.smallNet)}（${n(m.smallPct, 2, '%')}）`,
  ].join('\n');
}

function buildNewsBlock(news: NewsItem[]): string {
  if (!news.length) return '【消息面】\n  暂无明显个股相关新闻';
  const items = news
    .slice(0, 10)
    .map((item, i) => `  ${i + 1}. [${(item.time || '').slice(5, 16)}] ${item.title}`)
    .join('\n');
  return `【消息面（近期相关新闻，共 ${news.length} 条）】\n${items}`;
}

function buildAnnouncementBlock(list: Announcement[]): string {
  if (!list.length) return '【公告面】\n  近期无重大公告';
  const items = list
    .map((a, i) => `  ${i + 1}. [${a.date}]【${a.type}】${a.title}`)
    .join('\n');
  return `【公告面（近期交易所披露）】\n${items}`;
}

// ============================================================
// 主 Prompt 构建器（对外唯一入口）
// ============================================================

/**
 * 构建完整的分析 prompt 消息数组。
 * 直接传给 chatLLM / chatLLMStream 的 messages 参数。
 */
export function buildAnalysisPrompt(input: PromptInputs) {
  const { quote, fundamental, moneyflow, klines, announcements, relatedNews } = input;

  const userContent = [
    `标的：${quote.name}（${quote.code}）`,
    '',
    buildQuoteBlock(quote),
    '',
    buildFundamentalBlock(fundamental),
    '',
    buildTechnicalBlock(klines),
    '',
    buildMoneyFlowBlock(moneyflow),
    '',
    buildNewsBlock(relatedNews),
    '',
    buildAnnouncementBlock(announcements),
    '',
    '请基于以上全部事实，按要求输出 JSON 分析结果。',
  ].join('\n');

  return [
    { role: 'system' as const, content: SYSTEM_PROMPT },
    { role: 'user'   as const, content: userContent   },
  ];
}

// ============================================================
// JSON 解析（带容错 + 修复 Prompt）
// ============================================================

/**
 * 解析模型输出为结构化对象。
 * 兼容：```json...``` 包裹 / 正文嵌入 JSON / 纯 JSON 字符串。
 * 解析失败时抛出 Error（由调用方决定是否重试）。
 */
/** 将数组项统一转为字符串，兼容模型偶尔返回对象的情况 */
function itemToStr(item: unknown): string {
  if (typeof item === 'string') return item;
  if (item != null && typeof item === 'object') {
    const o = item as Record<string, unknown>;
    // 常见字段名：text / content / reason / point / title / description
    const v = o.text ?? o.content ?? o.reason ?? o.point ?? o.title ?? o.description;
    if (typeof v === 'string') return v;
    return JSON.stringify(item);
  }
  return String(item ?? '');
}

export function parseAnalysisJSON(text: string) {
  // 1. 去掉 DeepSeek-Reasoner 的 <think>...</think> 推理块
  let body = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  if (!body) body = text.trim(); // 防止全部被剥掉

  // 2. 剥离代码块包裹
  const fence = body.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) body = fence[1].trim();

  // 3. 定位最后一个合法 JSON 对象（避免 think 块内的花括号干扰）
  let parsed: Record<string, unknown> | null = null;
  let last = body.lastIndexOf('}');
  while (last > 0 && parsed === null) {
    const first = body.lastIndexOf('{', last);
    if (first === -1) break;
    try {
      parsed = JSON.parse(body.slice(first, last + 1));
    } catch {
      last = body.lastIndexOf('}', last - 1);
    }
  }
  if (!parsed) throw new Error('无法从模型输出中提取合法 JSON');

  return {
    scores:     (parsed.scores as Record<string, number>) || {},
    conclusion: String(parsed.conclusion || ''),
    bullish:    Array.isArray(parsed.bullish) ? parsed.bullish.map(itemToStr) : [],
    bearish:    Array.isArray(parsed.bearish) ? parsed.bearish.map(itemToStr) : [],
    risks:      Array.isArray(parsed.risks)   ? parsed.risks.map(itemToStr)   : [],
    suggestion: String(parsed.suggestion || ''),
  };
}

/**
 * 修复 Prompt：当模型第一次输出不合规 JSON 时，让它自我修正。
 * 使用较低 temperature（0.1）确保输出更规整。
 */
export function buildFixupPrompt(badOutput: string) {
  return [
    {
      role: 'system' as const,
      content:
        '你收到了一段未严格遵守 JSON 格式的文本。请提取其中的核心内容，' +
        '重新输出为以下 JSON 格式（不允许 markdown / 注释 / 多余文字）：\n' +
        '{"scores":{"基本面":0,"技术面":0,"资金面":0,"消息面":0},' +
        '"conclusion":"...","bullish":["..."],"bearish":["..."],"risks":["..."],"suggestion":"..."}',
    },
    { role: 'user' as const, content: badOutput },
  ];
}
