import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    const devBackendUrl = env.SHEETCANVAS_DEV_BACKEND_URL || 'http://127.0.0.1:8787';
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
        proxy: {
          '/api': { target: devBackendUrl, ws: true },
          '/mcp': { target: devBackendUrl },
        },
      },
      plugins: [react()],
      define: {
        'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY)
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
