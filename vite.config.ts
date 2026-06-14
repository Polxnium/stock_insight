import 'dotenv/config'; // 让 BFF handlers 能读取 .env 中的 API Key
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { registerApiHandlers } from './server/handlers.mjs';

/**
 * 开发服务器直接挂载与 server.mjs 相同的 /api 处理逻辑，
 * 这样开发态、生产态共用一套 BFF 实现，避免不一致。
 */
export default defineConfig({
  plugins: [
    react(),
    {
      name: 'stock-insight-bff',
      configureServer(server) {
        registerApiHandlers(server.middlewares);
      },
    },
  ],
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  server: {
    port: 5173,
  },
});

