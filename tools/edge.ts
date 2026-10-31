// npx tsx tools/edge.ts — mobile edge cases in the production build (dist/): input never stuck,
// pause on blur, rotate overlay on a landscape phone, no page scroll, no external requests.
//   --dir=<folder> --prefix=/game   serve another folder and load the game from a sub-path
//   (the unpacked release zip: proves the relative base works like on itch).
import type { Page } from 'playwright';
import { launch } from './browser';
import { serveStatic } from './static';

const results: [string, boolean, string][] = [];
const check = (name: string, ok: boolean, info = ''): void => {
  results.push([name, ok, info]);
};
const ev = <T>(page: Page, js: string): Promise<T> => page.evaluate(js) as Promise<T>;
const tap = (type: string, id = 1): string =>
  `document.getElementById('root').dispatchEvent(new PointerEvent('${type}', { pointerId: ${id}, bubbles: true, button: 0, pointerType: 'touch' }))`;

const arg = (k: string, d: string): string => process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=')[1] ?? d;

async function main(): Promise<void> {
  const log: string[] = [];
  const { url: root, server } = await serveStatic(arg('dir', 'dist'), log);
  const url = root + arg('prefix', '');
  const browser = await launch();
  const external: string[] = [];
  const errors: string[] = [];
  const phone = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true };
  const ctx = await browser.newContext(phone);
  await ctx.addInitScript("localStorage.setItem('sunsetdash.tutorialSeen', '1')"); // returning player (the how-to card is shot in npm run shot)
  const page = await ctx.newPage();
  page.on('request', (r) => !r.url().startsWith(url) && !r.url().startsWith('data:') && external.push(r.url()));
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(`${url}/index.html?seed=3`);
  await page.waitForFunction('!!window.__sd');
  await page.waitForTimeout(300);

  await ev(page, tap('pointerdown'));
  check('tap starts the run', (await ev(page, 'window.__sd.state()')) === 'playing');
  check('held while pressed', await ev(page, 'window.__sd.held()'));
  await ev(page, tap('pointercancel'));
  check('pointercancel releases', !(await ev(page, 'window.__sd.held()')));
  await ev(page, tap('pointerdown', 2));
  await ev(page, "window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 2 }))");
  check('pointerup outside the root releases', !(await ev(page, 'window.__sd.held()')));
  await ev(page, tap('pointerdown', 3));
  await ev(page, "window.dispatchEvent(new Event('blur'))");
  check('blur releases the press', !(await ev(page, 'window.__sd.held()')));
  check('blur pauses', (await ev(page, 'window.__sd.state()')) === 'paused');
  await page.click('.pause-screen .btn-main');
  check('Resume button resumes without a press', (await ev(page, 'window.__sd.state()')) === 'playing' && !(await ev(page, 'window.__sd.held()')));
  await ev(page, tap('pointerdown', 4));
  await ev(page, "window.dispatchEvent(new TouchEvent('touchend', { touches: [] }))");
  check('touchend with no touches releases', !(await ev(page, 'window.__sd.held()')));
  const scroll = await ev<{ sw: number; w: number; sh: number; h: number }>(page, '({ sw: document.documentElement.scrollWidth, w: innerWidth, sh: document.documentElement.scrollHeight, h: innerHeight })');
  check('no page scroll', scroll.sw <= scroll.w && scroll.sh <= scroll.h, JSON.stringify(scroll));
  check('no debug UI without flags', (await ev<number>(page, "document.querySelectorAll('.lil-gui, .tune, .debug').length")) === 0);
  await ctx.close();

  const land = await browser.newContext({ ...phone, viewport: { width: 844, height: 390 } });
  const p2 = await land.newPage();
  await p2.goto(`${url}/index.html?seed=3`);
  await p2.waitForFunction('!!window.__sd');
  check('landscape phone: rotate overlay', await ev(p2, "!!document.querySelector('.rotate-screen.visible')"));
  await land.close();
  await browser.close();
  server.close();

  check('no external requests', external.length === 0, external.join(' '));
  check('no page errors', errors.length === 0, errors.join(' | '));
  for (const [n, ok, info] of results) console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${info && !ok ? `  (${info})` : ''}`);
  console.log(`  requests: ${[...new Set(log)].join(' ')}`);
  const fail = results.filter((r) => !r[1]).length;
  console.log(fail ? `EDGE: ${fail} FAIL` : 'EDGE: PASS');
  process.exitCode = fail ? 1 : 0;
}

void main();
