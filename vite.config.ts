import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: { host: true, port: 5173 },
  build: { outDir: 'dist', assetsInlineLimit: 0, target: 'es2020', chunkSizeWarningLimit: 800 },
});
