// npm run perf — production build (dist/) in Chromium 720x1280 @2x with 4x CPU throttling (CDP),
// bot autopilot. Prints frame times, the quality level the auto step-down settled on, draw calls,
// JS allocation rate while playing and the heap retained after GC.
//   npm run perf -- --quality=0   pin a quality level (no step-down)    --secs=30  --throttle=4
import { launch } from './browser';
import { serveStatic } from './static';

const arg = (k: string, d: string): string => process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=')[1] ?? d;
const secs = Number(arg('secs', '30'));
const throttle = Number(arg('throttle', '4'));
const pinned = arg('quality', '');
const profile = process.argv.includes('--profile');

async function main(): Promise<void> {
  const { url, server } = await serveStatic('dist');
  const browser = await launch();
  const ctx = await browser.newContext({ viewport: { width: 720, height: 1280 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const cdp = await ctx.newCDPSession(page);
  await page.goto(`${url}/index.html?bot=1&seed=3${pinned ? `&quality=${pinned}` : ''}`);
  await page.waitForFunction("!!window.__sd && window.__sd.state() === 'playing'", null, { timeout: 20000 });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
  await cdp.send('HeapProfiler.enable');
  await cdp.send('HeapProfiler.collectGarbage');
  const heap0 = (await cdp.send('Runtime.getHeapUsage')).usedSize;
  // (a string: tsx would inject helpers into a function body that don't exist in the page)
  await page.evaluate(`(() => {
    window.__ft = [];
    window.__q = [];
    let last = performance.now(), q = -1;
    const t0 = last;
    const tick = (now) => {
      window.__ft.push(now - last);
      last = now;
      const lv = window.__sd.quality();
      if (lv !== q) window.__q.push([(now - t0) / 1000, (q = lv)]);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  })()`);
  // sampled allocation profile of the page (V8 sampling heap profiler, 4 KB interval)
  await cdp.send('HeapProfiler.startSampling', { samplingInterval: 4096 });
  await new Promise((r) => setTimeout(r, secs * 1000));
  interface Node { callFrame: { functionName: string; url: string; lineNumber: number }; selfSize: number; children: Node[] }
  const { profile: prof } = (await cdp.send('HeapProfiler.stopSampling')) as unknown as { profile: { head: Node } };
  const sites = new Map<string, number>();
  let alloc = 0;
  const walk = (n: Node, stack: string): void => {
    const f = n.callFrame;
    const here = `${f.functionName || '(anon)'} ${f.url.split('/').pop()}:${f.lineNumber + 1}`;
    // the measuring rAF hook itself does not count
    if (n.selfSize && !f.url.startsWith('http') && f.functionName === 'tick') return;
    alloc += n.selfSize;
    const key = `${here}  <-  ${stack}`;
    if (n.selfSize) sites.set(key, (sites.get(key) ?? 0) + n.selfSize);
    for (const c of n.children) walk(c, here);
  };
  walk(prof.head, '');
  if (profile) {
    console.log('  top allocation sites (KB over the run):');
    for (const [k, v] of [...sites].sort((a, b) => b[1] - a[1]).slice(0, 18)) console.log(`    ${(v / 1024).toFixed(0).padStart(6)}  ${k}`);
  }
  const res = (await page.evaluate(
    '({ ft: window.__ft.slice(1), q: window.__q, calls: window.__sd.renderer.drawCalls, t: window.__sd.run().t })',
  )) as { ft: number[]; q: [number, number][]; calls: number; t: number };
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  await cdp.send('HeapProfiler.collectGarbage');
  const heap1 = (await cdp.send('Runtime.getHeapUsage')).usedSize;
  await browser.close();
  server.close();

  const ft = res.ft.sort((a, b) => a - b);
  const pct = (p: number): number => ft[Math.min(ft.length - 1, Math.floor(ft.length * p))];
  const avg = ft.reduce((a, b) => a + b, 0) / ft.length;
  console.log(`perf: ${secs} s, CPU throttle ${throttle}x, 720x1280 @2x, ${pinned ? `quality pinned ${pinned}` : 'auto quality'}`);
  console.log(`  frames ${ft.length}  avg ${avg.toFixed(1)} ms (${(1000 / avg).toFixed(0)} fps)  p50 ${pct(0.5).toFixed(1)}  p95 ${pct(0.95).toFixed(1)}  p99 ${pct(0.99).toFixed(1)} ms`);
  console.log(`  quality levels (t s -> level): ${res.q.map(([t, l]) => `${t.toFixed(1)}->${l}`).join('  ')}`);
  console.log(`  draw calls (last frame) ${res.calls}   sim time ${res.t.toFixed(1)} s`);
  console.log(`  JS heap: allocations ~${(alloc / 1024 / secs).toFixed(0)} KB/s (~${(alloc / ft.length).toFixed(0)} B/frame, sampled), retained after GC ${((heap1 - heap0) / 1024).toFixed(0)} KB over the run`);
  if (errors.length) console.log(`  PAGE ERRORS: ${errors.join(' | ')}`);
}

void main();
