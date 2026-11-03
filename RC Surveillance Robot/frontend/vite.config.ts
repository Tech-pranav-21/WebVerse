import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'url';
import { defineConfig, loadEnv } from 'vite';

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
    plugins: [react(), tailwindcss()],
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
