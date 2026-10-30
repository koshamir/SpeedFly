import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import { parseTuning, tuningJson } from './src/tuning';

const TUNING = fileURLToPath(new URL('./tuning.json', import.meta.url));

// Dev only: the Tune panel's Save POSTs here; we validate and write tuning.json (pretty-printed).
// The file watcher then hot-applies it in every open tab (main.ts import.meta.hot.accept).
function tuningSave(): Plugin {
  return {
    name: 'tuning-save',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__tuning', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end('POST only');
          return;
        }
        let body = '';
        req.setEncoding('utf8');
        req.on('data', (c: string) => {
          body += c;
          if (body.length > 64 * 1024) req.destroy();
        });
        req.on('end', () => {
          try {
            writeFileSync(TUNING, tuningJson(parseTuning(JSON.parse(body))));
            res.end('ok');
          } catch (e) {
            res.statusCode = 400;
            res.end(e instanceof Error ? e.message : 'bad request');
          }
        });
      });
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [tuningSave()],
  server: { host: true, port: 5173 },
  build: { outDir: 'dist', assetsInlineLimit: 0, target: 'es2020', chunkSizeWarningLimit: 800 },
});
