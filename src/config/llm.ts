// LLM 配置 —— 增删模型只需改这里
export type LLMProvider = 'deepseek' | 'qwen';

export interface LLMModelConfig {
  id: string; // 前端唯一标识
  provider: LLMProvider;
  model: string; // 上游 model 名
  label: string; // UI 显示
  good_at?: string;
}

export const LLM_MODELS: LLMModelConfig[] = [
  {
    id: 'deepseek-chat',
    provider: 'deepseek',
    model: 'deepseek-chat',
    label: 'DeepSeek V3',
    good_at: '通用快速分析',
  },
  {
    id: 'deepseek-reasoner',
    provider: 'deepseek',
    model: 'deepseek-reasoner',
    label: 'DeepSeek R1',
    good_at: '深度推理（慢但稳）',
  },
  {
    id: 'qwen-max',
    provider: 'qwen',
    model: 'qwen-max',
    label: '通义千问 Max',
    good_at: '中文金融语境',
  },
  {
    id: 'qwen-plus',
    provider: 'qwen',
    model: 'qwen-plus',
    label: '通义千问 Plus',
    good_at: '性价比首选',
  },
];

export const DEFAULT_MODEL_ID = 'deepseek-chat';
