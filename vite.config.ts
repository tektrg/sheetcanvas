import fs from 'fs';
import path from 'path';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// Self-host Excalidraw's fonts for the diagram editor (components/DiagramEditor.tsx).
// Xiaolai (CJK, ~12 MB) is skipped; Excalidraw falls back to its CDN for it.
const copyExcalidrawFonts = (): Plugin => ({
  name: 'copy-excalidraw-fonts',
  apply: 'build',
  closeBundle() {
    const source = path.resolve(__dirname, 'node_modules/@excalidraw/excalidraw/dist/prod/fonts');
    const target = path.resolve(__dirname, 'dist/excalidraw-assets/fonts');
    fs.cpSync(source, target, { recursive: true, filter: (file) => !file.includes(`${path.sep}Xiaolai`) });
  },
});

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      plugins: [react(), copyExcalidrawFonts()],
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
