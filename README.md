# Insight · A股实时多维分析

> 极简、明亮、轻量，本地一台机器即可跑起。

## 快速开始

```bash
# 1. 安装依赖
npm install

# 2. 配置 LLM Key
cp .env.example .env
# 编辑 .env，填入 DEEPSEEK_API_KEY 和/或 DASHSCOPE_API_KEY

# 3. 开发模式（热更新，端口 5173）
npm run dev

# 4. 生产模式（构建后用 Node 启动单进程）
npm run build
npm start
```

打开 http://localhost:5173 即可。

## 功能

- 大盘指数实时滚动（上证 / 深证 / 创业板 / 沪深300）
- 自选股列表（本地持久化，5 秒刷新）
- 实时财经快讯（30 秒刷新）
- 单只股票多维度 AI 分析（基本面 / 技术面 / 资金面 / 消息面）

## 配置

| 想改的东西 | 改这里 |
|---|---|
| 默认自选股 | `src/config/stocks.ts` |
| 大盘指数 | `src/config/indices.ts` |
| LLM 模型列表 | `src/config/llm.ts` |
| 新增数据源 / 接口代理 | `server/handlers.mjs` |
| 配色主题 | `tailwind.config.js` |

## 架构

```
浏览器 ──HTTP──> Vite/Express (BFF)
                   │
                   ├── /api/quote        新浪财经
                   ├── /api/news         东方财富
                   ├── /api/em/*         东财通用透传
                   └── /api/llm/chat     DeepSeek / 通义千问
                                         （Key 仅在服务端）
```

开发态和生产态共用 `server/handlers.mjs`，确保行为一致。

## 后续可扩展

- [ ] 接入东财 F10 基本面 / 资金流 / K线
- [ ] LLM 流式输出
- [ ] 个股相关新闻智能聚合
- [ ] 一键摸鱼模式（伪装成 IDE）
- [ ] 多股票对比

## 免责声明

数据源自第三方公开接口，可能存在延迟或不准确；分析结果由大模型生成，仅供研究参考，**不构成任何投资建议**。
