// npm run shot — playwright, 720x1280 @2x, bot autopilot, screenshots into shots/.
// Each page waits for game states through window.__sd (exposed by main.ts) and captures them.
//   npm run shot -- 01 02   only shots whose names start with these prefixes
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import type { Browser, Page } from 'playwright';
import { launch } from './browser';
import { createServer } from 'vite';

interface Shot {
  name: string;
  when: string; // JS predicate evaluated in the page (sd = window.__sd)
  timeout?: number;
  delay?: number; // ms after the predicate holds
}

interface Session {
  query: string;
  shots: Shot[];
  desktop?: boolean; // 1600x900 @1x mouse instead of the 720x1280 @2x phone
  init?: string; // script run before the page loads (e.g. storage for an open Tune panel)
  act?: string; // script run once the game is up (e.g. a synthetic tap to start without the bot)
}

const SESSIONS: Session[] = [
  {
    query: '?bot=1&seed=3',
    shots: [
      { name: '01-title', when: "sd.state() === 'title'", delay: 400 },
      { name: '02-start', when: "sd.state() === 'playing' && sd.run().t > 2.5" },
      { name: '09-great', when: "sd.lastLand().kind === 'great' && sd.run().t - sd.lastLand().t > 0.1 && sd.run().t > 3" },
      { name: '03-flight', when: "sd.run().t > 6 && !sd.run().bird.grounded && sd.run().bird.airT > 0.5" },
      { name: '04-speed', when: 'sd.run().speed > 1300 && !sd.run().bird.grounded' },
      { name: '05-water', when: 'sd.run().world.islands?.length > 0 && sd.overWater?.()', timeout: 90000 },
      { name: '06-island2', when: 'sd.run().island >= 2', delay: 350, timeout: 90000 },
      { name: '07-fever', when: 'sd.run().fever === true', delay: 300, timeout: 60000 },
      { name: '08-late', when: 'sd.run().t > 40', timeout: 120000 },
      { name: '10-sky', when: 'sd.run().skyTouched && !sd.run().bird.grounded', delay: 120, timeout: 60000 },
    ],
  },
  {
    query: '?bot=none&seed=3',
    shots: [
      { name: '11-golden', when: "sd.state() === 'playing' && sd.run().daylight < 0.62" , timeout: 90000 },
      { name: '12-dusk', when: 'sd.run().daylight < 0.3', timeout: 90000 },
      { name: '13-night', when: 'sd.run().daylight < 0.06', timeout: 90000 },
      { name: '14-results', when: "sd.state() === 'results'", delay: 900, timeout: 90000 },
    ],
  },
  {
    // no bot: a tap starts the run, the Touch Teacher is on (fresh storage)
    query: '?seed=3',
    act: "(() => { const r = document.getElementById('root'); const o = { pointerId: 1, bubbles: true, button: 0, pointerType: 'touch' }; r.dispatchEvent(new PointerEvent('pointerdown', o)); setTimeout(() => r.dispatchEvent(new PointerEvent('pointerup', o)), 1200); })()",
    shots: [
      { name: '17-teacher-hold', when: "sd.state() === 'playing' && document.querySelector('.teacher.hold') && sd.run().t > 0.8" },
      { name: '18-teacher-let', when: "document.querySelector('.teacher.let, .teacher.soon') && sd.run().t > 1.5" },
    ],
  },
  {
    // a late bot falls short of an island gap at ~21.6 s: splash FX
    query: '?bot=1&botDelay=12&seed=5',
    shots: [{ name: '15-splash', when: "sd.lastLand().kind === 'splash' && sd.run().t - sd.lastLand().t > 0.15", timeout: 120000 }],
  },
  {
    // the naive bot lands badly every few seconds
    query: '?bot=naive&seed=3',
    shots: [{ name: '16-bad', when: "sd.lastLand().kind === 'bad' && sd.run().t - sd.lastLand().t > 0.1", timeout: 60000 }],
  },
  {
    query: '?bot=1&seed=5',
    desktop: true,
    shots: [
      { name: '21-desktop-title', when: "sd.state() === 'title'", delay: 400 },
      { name: '22-desktop-play', when: "sd.state() === 'playing' && sd.run().t > 4" },
    ],
  },
  {
    // Tune panel open on the Hills tab (profile preview drawn)
    query: '?tune=1&bot=1&seed=3',
    init: "localStorage.setItem('sunsetdash.tuneTab', '1'); sessionStorage.setItem('sd.tuneOpen', '1');",
    shots: [{ name: '31-tune-hills', when: "sd.state() === 'playing' && sd.run().t > 2 && !!document.querySelector('.tune-hstats')?.textContent", delay: 300 }],
  },
];

async function runSession(browser: Browser, base: string, s: Session): Promise<string[]> {
  const ctx = await browser.newContext(
    s.desktop
      ? { viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 }
      : { viewport: { width: 720, height: 1280 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  );
  if (s.init) await ctx.addInitScript(s.init);
  const page: Page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`);
  });
  await page.goto(base + s.query);
  await page.waitForFunction('!!window.__sd', null, { timeout: 20000 });
  if (s.act) await page.evaluate(s.act);
  const only = process.argv.slice(2);
  for (const shot of s.shots) {
    if (only.length && !only.some((p) => shot.name.startsWith(p))) continue;
    const t0 = Date.now();
    try {
      await page.waitForFunction(`(() => { const sd = window.__sd; try { return !!(${shot.when}); } catch { return false; } })()`, null, {
        timeout: shot.timeout ?? 45000,
        polling: 50,
      });
      if (shot.delay) await page.waitForTimeout(shot.delay);
      await page.screenshot({ path: `shots/${shot.name}.png` });
      const info = await page.evaluate(() => {
        const sd = (window as unknown as { __sd: { state(): string; run(): { t: number; speed: number; bird: { x: number } } } }).__sd;
        const r = sd.run();
        return `${sd.state()} t=${r.t.toFixed(1)} x=${r.bird.x.toFixed(0)} v=${r.speed.toFixed(0)}`;
      });
      console.log(`  ${shot.name}.png  (${((Date.now() - t0) / 1000).toFixed(1)} s)  ${info}`);
    } catch {
      console.log(`  ${shot.name}: SKIPPED (condition not reached: ${shot.when})`);
    }
  }
  const fps = await page.evaluate(() => (window as unknown as { __sd: { fps?: () => number } }).__sd.fps?.() ?? -1);
  const calls = await page.evaluate(() => (window as unknown as { __sd: { renderer: { drawCalls: number } } }).__sd.renderer.drawCalls);
  if (fps >= 0) console.log(`  avg fps in headless: ${fps.toFixed(0)}, draw calls (last frame): ${calls}`);
  await ctx.close();
  return errors;
}

async function main(): Promise<void> {
  if (existsSync('shots')) for (const f of readdirSync('shots')) rmSync(`shots/${f}`);
  mkdirSync('shots', { recursive: true });
  const server = await createServer({ server: { port: 5199, strictPort: false, host: '127.0.0.1' }, logLevel: 'error' });
  await server.listen();
  const base = server.resolvedUrls!.local[0];
  const browser = await launch();
  let errors: string[] = [];
  try {
    const only = process.argv.slice(2);
    const todo = SESSIONS.filter((s) => !only.length || s.shots.some((x) => only.some((p) => x.name.startsWith(p))));
    const results = await Promise.all(todo.map((s) => runSession(browser, base, s)));
    errors = results.flat();
  } finally {
    await browser.close();
    await server.close();
  }
  if (errors.length) {
    console.log(`\nPAGE ERRORS (${errors.length}):\n  ${[...new Set(errors)].slice(0, 20).join('\n  ')}`);
    process.exitCode = 1;
  } else console.log('\nno page errors');
}

void main();
