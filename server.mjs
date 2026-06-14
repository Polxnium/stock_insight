// 本地生产部署：先 npm run build 生成 dist/，再 node server.mjs
// 单进程 = 静态资源 + /api 代理 + LLM 中转
import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerApiHandlers } from './server/handlers.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

registerApiHandlers(app);

const distDir = path.join(__dirname, 'dist');
app.use(express.static(distDir));
app.get('*', (_req, res) => res.sendFile(path.join(distDir, 'index.html')));

const port = Number(process.env.PORT || 5173);
app.listen(port, () => {
  console.log(`\n  ➜  stock-insight  http://localhost:${port}\n`);
});
