// 预设热门标签
export const POPULAR_TAGS = [
  '电力', '光伏', '风电', '储能', '新能源',
  'PCB', 'CPO', '光模块', '光纤', '算力',
  'AI', '半导体', '芯片', '光刻机', '消费电子',
  '军工', '航天', '船舶', '机器人', '工业母机',
  '医药', '创新药', '医疗器械', 'CXO', '医美',
  '白酒', '食品饮料', '消费', '新零售', '电商',
  '银行', '证券', '保险', '地产', '基建',
  '煤炭', '钢铁', '有色', '化工', '周期',
];

// 自选股配置（用户可自由修改）。新浪代码规则：sh/sz + 6 位数字
export interface StockConfig {
  code: string; // 新浪格式，如 sh600519
  alias?: string; // 自定义备注名
  tags?: string[]; // 属性标签
}

export const DEFAULT_WATCHLIST: StockConfig[] = [
  { code: 'sh600519', alias: '贵州茅台' },
  { code: 'sh601318', alias: '中国平安' },
  { code: 'sz000858', alias: '五粮液' },
  { code: 'sz300750', alias: '宁德时代' },
  { code: 'sh600036', alias: '招商银行' },
];