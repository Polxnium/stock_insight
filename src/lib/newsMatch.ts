// 智能新闻筛选：给定股票名/代码，从新闻流里挑出"可能与之相关"的若干条。
// 策略（优先级降序）：
//   1) 全名完整匹配（最强信号，score=3）
//   2) 名称去后缀后的全称匹配（score=2）
//   3) 3 字简称匹配（score=1），过滤行业泛词
//   4) 2 字简称匹配（score=1），严格过滤行业泛词
//   5) 6 位代码匹配（score=2）
// 结果按 score 降序返回，同分保持原顺序
import type { NewsItem } from '@/types';

// 2/3 字行业通用词黑名单——这类词匹配到整个行业，而非具体公司
const GENERIC_TERMS = new Set([
  '风电', '光伏', '储能', '氢能', '核电', '火电', '水电', '电力',
  '煤炭', '石油', '天然气', '化工', '钢铁', '铝业', '铜业', '有色',
  '医药', '生物', '疫苗', '医疗', '银行', '券商', '保险', '基金',
  '地产', '房产', '物业', '建筑', '建材', '水泥', '玻璃',
  '白酒', '食品', '饮料', '农业', '养殖', '零售', '电商',
  '汽车', '新能源', '半导体', '芯片', '通信', '5G', '航空', '海运',
  '科技', '互联网', '人工智能', 'AI',
]);

// 行业关键词扩展表：公司名中含有的行业词 → 相关新闻搜索词列表
export const INDUSTRY_EXPAND: Record<string, string[]> = {
  '风电': ['风电', '风力发电', '海上风电', '陆上风电', '风机', '风场', '风资源'],
  '光伏': ['光伏', '太阳能', '硅片', '组件', '逆变器', 'TOPCon', 'HJT'],
  '储能': ['储能', '电化学储能', '液流电池', '飞轮储能', '储能系统', '储能电站'],
  '氢能': ['氢能', '氢气', '绿氢', '燃料电池', '制氢', '加氢'],
  '核电': ['核电', '核能', '核电站', '铀矿', '华龙一号', '核反应堆'],
  '火电': ['火电', '燃煤', '燃气发电', '热电联产'],
  '水电': ['水电', '水电站', '水力发电', '抽水蓄能'],
  '电力': ['电力', '电网', '输配电', '绿电', '电改', '电价'],
  '能源': ['能源', '新能源', '清洁能源', '可再生能源', '碳中和', '双碳'],
  '煤炭': ['煤炭', '动力煤', '炼焦煤', '煤价', '矿产', '采矿'],
  '石油': ['石油', '原油', '天然气', '油价', '成品油', '炼化', 'LNG'],
  '化工': ['化工', '化肥', '聚乙烯', '聚丙烯', '农药', '精细化工', '化学品'],
  '钢铁': ['钢铁', '钢材', '螺纹钢', '热轧', '冷轧', '铁矿石', '焦炭'],
  '铝业': ['铝', '铝合金', '氧化铝', '电解铝', '铝箔'],
  '铜业': ['铜', '铜价', '精铜', '铜矿', '铜箔'],
  '有色': ['有色金属', '稀土', '锂矿', '钴', '镍', '锰', '钨'],
  '医药': ['医药', '药品', '制药', '仿制药', '原料药', 'CXO', '医疗器械', '创新药', 'IND'],
  '生物': ['生物医药', '基因', 'mRNA', '抗体', '细胞治疗', 'CAR-T', '疫苗'],
  '医疗': ['医疗', '医院', '诊断', '手术机器人', '医疗设备', '耗材'],
  '银行': ['银行', '银行业', '信贷', '不良贷款', '存款', '利差', '资本充足'],
  '证券': ['券商', '证券', '经纪', '投行', 'IPO', '注册制', '再融资'],
  '保险': ['保险', '寿险', '财险', '再保险', '保费', '赔付'],
  '基金': ['公募基金', '私募基金', '基金净值', 'ETF', '债券基金'],
  '地产': ['房地产', '楼市', '开发商', '土地出让', '限购', '房价', '棚改'],
  '物业': ['物业', '物业管理', '物业费', '社区服务'],
  '建筑': ['建筑', '施工', '工程承包', '基建', 'EPC', '装配式'],
  '建材': ['建材', '水泥', '玻璃', '瓷砖', '石膏板', '防水材料'],
  '白酒': ['白酒', '酿酒', '名酒', '茅台', '五粮液', '汾酒', '酒企'],
  '食品': ['食品', '食品安全', '调味品', '速冻', '烘焙'],
  '饮料': ['饮料', '软饮料', '功能饮料', '果汁', '矿泉水'],
  '零售': ['零售', '商超', '便利店', '连锁', '消费品', '社区团购'],
  '汽车': ['汽车', '乘用车', '新能源汽车', '电动车', '整车', '自动驾驶', '智能汽车'],
  '半导体': ['半导体', '芯片', '集成电路', '晶圆', '封测', 'EDA', 'SiC'],
  '电子': ['消费电子', '元器件', '印刷电路板', 'PCB', 'OLED', '显示面板'],
  '通信': ['通信', '5G', '6G', '基站', '运营商', '光模块', '卫星互联网'],
  '航空': ['航空', '航线', '客运量', '机票', '飞机', '机场', '民航'],
  '海运': ['航运', '海运', '集装箱', '运价指数', '干散货', '油轮', 'VLCC'],
  '农业': ['农业', '种子', '化肥', '农药', '粮食', '农资'],
  '养殖': ['养殖', '猪肉', '生猪', '禽类', '水产', '饲料'],
};

/**
 * 根据股票全名提取行业关键词列表（用于行业新闻 tab 过滤）
 * @param stockName 股票名称
 * @param industryEM EM2016 行业分类数组，如 ['公用事业', '电力', '新能源发电']，优先级最高
 */
export function getIndustryKeywords(stockName: string, industryEM?: string[]): string[] {
  const found = new Set<string>();

  // 1) 优先使用精确行业分类（来自东方财富 EM2016 字段）
  if (industryEM && industryEM.length > 0) {
    industryEM.forEach((term) => {
      // 每个层级词直接加入
      found.add(term);
      // 尝试匹配 INDUSTRY_EXPAND 扩展词
      for (const [key, expanded] of Object.entries(INDUSTRY_EXPAND)) {
        if (term.includes(key) || key.includes(term)) {
          expanded.forEach((k) => found.add(k));
        }
      }
    });
    return [...found];
  }

  // 2) 兜底：从公司名称猜测行业（原有逻辑）
  const cleaned = stockName
    .replace(/(股份有限公司|有限公司|集团股份|集团|股份|控股|能源|发展|投资|实业)$/g, '')
    .trim();
  for (const [key, expanded] of Object.entries(INDUSTRY_EXPAND)) {
    if (cleaned.includes(key)) {
      expanded.forEach((k) => found.add(k));
    }
  }
  return [...found];
}

/**
 * 从新闻流中筛选行业动态（排除已作为个股相关新闻的条目）
 */
export function pickIndustryNews(
  all: NewsItem[],
  industryKeywords: string[],
  excludeCompanyKeys: string[],
  limit = 10,
): NewsItem[] {
  if (industryKeywords.length === 0) return [];
  return all
    .filter((n) => {
      const blob = `${n.title || ''} ${n.summary || ''}`;
      if (!industryKeywords.some((k) => blob.includes(k))) return false;
      // 排除已在「相关新闻」展示的个股新闻
      if (excludeCompanyKeys.some((k) => blob.includes(k))) return false;
      return true;
    })
    .slice(0, limit);
}

function buildKeys(fullName: string): { key: string; score: number }[] {
  const result: { key: string; score: number }[] = [];
  if (!fullName) return result;

  result.push({ key: fullName, score: 3 });

  const cleaned = fullName
    .replace(/(股份有限公司|有限公司|集团股份|集团|股份|科技|控股|能源)$/g, '')
    .trim();
  if (cleaned && cleaned !== fullName && cleaned.length >= 2) {
    result.push({ key: cleaned, score: 2 });
  }

  const base = cleaned || fullName;
  // 3 字简称
  if (base.length >= 3) {
    const k3 = base.slice(-3);
    if (!GENERIC_TERMS.has(k3)) result.push({ key: k3, score: 1 });
  }
  // 2 字简称（只在不是泛词时使用）
  if (base.length >= 2) {
    const k2 = base.slice(-2);
    if (!GENERIC_TERMS.has(k2)) result.push({ key: k2, score: 1 });
  }

  return result;
}

export function pickRelatedNews(
  all: NewsItem[],
  opts: { name: string; code: string; limit?: number },
): NewsItem[] {
  const { name, code, limit = 10 } = opts;
  const num = code.replace(/^(sh|sz)/i, '');
  const keys = buildKeys(name);

  const scored = all
    .map((n) => {
      const blob = `${n.title || ''} ${n.summary || ''}`;
      // 代码匹配
      if (num.length === 6 && blob.includes(num)) return { n, score: 2 };
      // 名称关键词匹配，取最高分
      let best = 0;
      for (const { key, score } of keys) {
        if (blob.includes(key) && score > best) best = score;
      }
      return best > 0 ? { n, score: best } : null;
    })
    .filter((x): x is { n: NewsItem; score: number } => x !== null);

  // 按 score 降序，同分保留原顺序
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((x) => x.n);
}
