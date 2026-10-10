import { defineConfig } from 'vite';

const backend = process.env.DEV_API_TARGET || 'http://127.0.0.1:8787';

export default defineConfig({
  build: { rollupOptions: { input: { main: 'index.html', assistantCat: 'assistant-cat.html' } } },
  server: {
    port: 5173,
    proxy: {
      '/api': backend,
      '/voice': { target: backend.replace(/^http/, 'ws'), ws: true },
    },
  },
});
