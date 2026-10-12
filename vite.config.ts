import fs from 'fs';
import path from 'path';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// Self-host Excalidraw's fonts for the diagram editor (components/DiagramEditor.tsx).
// Xiaolai (CJK, ~12 MB) is skipped; Excalidraw falls back to its CDN for it.
const copyExcalidrawFonts = (): Plugin => {
  let outDir = 'dist';
  return {
    name: 'copy-excalidraw-fonts',
    apply: 'build',
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir);
    },
    closeBundle() {
      const source = path.resolve(__dirname, 'node_modules/@excalidraw/excalidraw/dist/prod/fonts');
      const target = path.join(outDir, 'excalidraw-assets/fonts');
      fs.cpSync(source, target, { recursive: true, filter: (file) => !file.includes(`${path.sep}Xiaolai`) });
    },
  };
};

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
