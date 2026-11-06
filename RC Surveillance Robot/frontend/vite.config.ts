import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'url';
import { defineConfig, loadEnv, type Plugin } from 'vite';

function docsImagesPlugin(): Plugin {
  const docsImagesDir = fileURLToPath(new URL('../docs/images', import.meta.url));

  return {
    name: 'vite-plugin-docs-images',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const decodedUrl = decodeURIComponent(req.url || '');
        if (decodedUrl.startsWith('/docs/images/')) {
          const fileName = decodedUrl.replace(/^\/docs\/images\//, '').split('?')[0];
          const filePath = path.join(docsImagesDir, fileName);
          if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
            const ext = path.extname(filePath).toLowerCase();
            const mimeMap: Record<string, string> = {
              '.jpeg': 'image/jpeg',
              '.jpg': 'image/jpeg',
              '.png': 'image/png',
              '.webp': 'image/webp',
              '.svg': 'image/svg+xml',
            };
            res.setHeader('Content-Type', mimeMap[ext] || 'application/octet-stream');
            res.setHeader('Cache-Control', 'no-cache');
            fs.createReadStream(filePath).pipe(res);
            return;
          }
        }
        next();
      });
    },
    generateBundle() {
      if (fs.existsSync(docsImagesDir)) {
        const files = fs.readdirSync(docsImagesDir);
        for (const file of files) {
          const filePath = path.join(docsImagesDir, file);
          if (fs.statSync(filePath).isFile()) {
            this.emitFile({
              type: 'asset',
              fileName: `docs/images/${file}`,
              source: fs.readFileSync(filePath),
            });
          }
        }
      }
    },
  };
}

export default defineConfig(({ mode }) => {
  // The AI backend (server/, `npm run server`) holds the Groq key. The browser reaches it on the same
  // origin through this proxy. loadEnv() reads .env for THIS config only: it does not put anything
  // into the web page (only VITE_ variables are exposed to the browser).
  const env = loadEnv(mode, process.cwd(), '');
  const aiBackend = `http://127.0.0.1:${env.AI_SERVER_PORT || '8787'}`;
  const poseBackend = `http://127.0.0.1:${env.POSE_SERVICE_PORT || '8000'}`;
  const apiProxy = {
    '/api/pose': {
      target: poseBackend,
      rewrite: (path: string) => path.replace(/^\/api\/pose/, ''),
    },
    '/api': { target: aiBackend },
  };

  return {
    plugins: [react(), tailwindcss(), docsImagesPlugin()],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('.', import.meta.url)),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
      proxy: apiProxy,
    },
    preview: { proxy: apiProxy },
  };
});
