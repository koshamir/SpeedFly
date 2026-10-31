import '@fontsource/lilita-one/latin-400.css';
import '@fontsource/fredoka/latin-500.css';
import '@fontsource/fredoka/latin-600.css';
import './ui/styles.css';
import tuningFile from '../tuning.json';
import { Audio } from './audio/audio';
import { CONFIG } from './config';
import { EventBus, type GameEvents } from './core/events';
import { Input } from './core/input';
import { Loop } from './core/loop';
import { load, save } from './core/storage';
import { Quality } from './render/quality';
import { Renderer } from './render/renderer';
import { Bot, type BotPolicy } from './sim/bot';
import { Run } from './sim/run';
import { el, Hud } from './ui/hud';
import { Popups, type PopupKind } from './ui/popups';
import { applyTuning, parseTuning, worldKey } from './tuning';
import { islandStyle } from './world/islands';
import { Screens } from './ui/screens';
import { Teacher } from './ui/teacher';
import type { TunePanel } from './ui/tune';
import type { TerrainMode } from './world/world';

// tuning.json is what ships: preset + overrides, applied before anything reads CONFIG.
applyTuning(parseTuning(tuningFile));

// Bootstrap, resize and the state machine: Title -> Playing <-> Paused -> Caught -> Results -> Playing.
type State = 'title' | 'playing' | 'paused' | 'caught' | 'results';

const params = new URLSearchParams(location.search);
const debugOn = params.get('debug') === '1';
const tuneOn = params.get('tune') === '1';
const botParam = params.get('bot');
const botPolicy: BotPolicy | null =
  botParam === null || botParam === '0'
    ? null
    : botParam === 'none' || botParam === 'always' || botParam === 'naive'
      ? botParam
      : 'planner';
const botDelay = Number(params.get('botDelay') ?? 0) | 0;
const fixedSeed = params.has('seed') ? Number(params.get('seed')) | 0 : null;
const mode: TerrainMode = params.get('terrain') === 'reference' ? 'reference' : 'islands';
const randomSeed = (): number => (Math.random() * 0x7fffffff) | 0;
const newSeed = (): number => fixedSeed ?? randomSeed();

const root = document.getElementById('root')!;
const canvas = document.getElementById('game') as HTMLCanvasElement;
const uiRoot = document.getElementById('ui')!;
const coarse = matchMedia('(pointer: coarse)').matches;

const bus = new EventBus<GameEvents>();
const renderer = new Renderer(canvas, bus, debugOn);
const quality = new Quality(params.has('quality') ? Number(params.get('quality')) | 0 : null);
renderer.setQuality(quality.dpr, quality.particles, quality.grain);
const input = new Input(root);
const hud = new Hud(uiRoot);
const popups = new Popups(uiRoot);
const screens = new Screens(uiRoot);
const audio = new Audio(bus);
const teacher = new Teacher(uiRoot, botPolicy !== null);
const soundBtn = el('button', 'btn-round btn-sound', uiRoot);
soundBtn.setAttribute('data-ui', '');
soundBtn.setAttribute('aria-label', 'Sound');
soundBtn.innerHTML =
  '<svg viewBox="0 0 40 40"><path d="M6 15h7l9-8v26l-9-8H6z" fill="#241B3A"/><path class="wave" d="M27 14q4 6 0 12M31 10q7 10 0 20" fill="none" stroke="#241B3A" stroke-width="3.5" stroke-linecap="round"/><path class="cross" d="M27 15l9 10M36 15l-9 10" stroke="#E84A5F" stroke-width="4" stroke-linecap="round"/></svg>';
const syncSound = (): void => {
  soundBtn.classList.toggle('off', audio.muted);
};
syncSound();
soundBtn.addEventListener('click', () => {
  audio.unlock();
  audio.setMuted(!audio.muted);
  audio.click();
  syncSound();
});
// WebAudio needs a user gesture (iOS: inside touchend/pointerdown): unlock on every gesture
for (const type of ['pointerdown', 'touchend', 'keydown'])
  window.addEventListener(type, () => audio.unlock(), { capture: true, passive: true });
let run = new Run(newSeed(), mode, bus);
let bot = botPolicy ? new Bot(run.world.terrain, botPolicy, botDelay) : null;
renderer.setRun(run);
let teachCur = run.world.terrain.cursor();

let best = Number(load('best')) || 0;
screens.setBest(best);
let state: State = 'title';
let stateT = 0;
let stepsThisFrame = 0;
let rotated = false;

function setState(s: State): void {
  state = s;
  stateT = 0;
  audio.setRunning(s !== 'paused' && !document.hidden);
  if (s === 'title') audio.setMood('title');
  else if (s === 'playing') audio.setMood('play');
  else if (s === 'results') audio.setMood('results');
  loop.simulate = s === 'playing';
  hud.show(s === 'playing' || s === 'paused' || s === 'caught');
  screens.showOnly(s === 'title' ? screens.title : s === 'paused' ? screens.pause : s === 'results' ? screens.results : null);
  if (s === 'results') {
    const total = Math.floor(run.score.total);
    const isNew = total > best;
    if (isNew) {
      best = total;
      save('best', String(best));
      screens.setBest(best);
    }
    screens.fillResults(run, best, isNew);
    audio.results(isNew);
    screens.setRetryLocked(true);
  }
}

function newRun(seed = newSeed()): void {
  jump.on = false;
  jump.banner = 0;
  jump.t0 = jump.tLand = -1;
  run = new Run(seed, mode, bus);
  bot = botPolicy ? new Bot(run.world.terrain, botPolicy, botDelay) : null;
  renderer.setRun(run);
  teachCur = run.world.terrain.cursor();
  popups.clear();
}

function startPlaying(): void {
  run.start();
  setState('playing');
  audio.go();
}

function retry(): void {
  if (state !== 'results' || stateT < CONFIG.ui.retryLock) return;
  newRun();
  startPlaying();
}

/** Same or new seed: rebuild the world; the title stays the title, anything else plays at once. */
function restart(seed: number): void {
  newRun(seed);
  if (state === 'title') return;
  run.start();
  setState(rotated ? 'paused' : 'playing');
}

function togglePause(): void {
  if (state === 'playing') setState('paused');
  else if (state === 'paused' && !rotated) setState('playing');
}

// ---------- input ----------
input.onPress = (kind) => {
  if (state === 'title' && !rotated) startPlaying();
  else if (state === 'results' && kind === 'key') retry();
};
input.onKey = (code) => {
  if (tune?.key(code)) return;
  if (code === 'KeyT' && import.meta.env.DEV) return loadTune(true);
  if (code === 'Escape' || code === 'KeyP') togglePause();
  else if (code === 'Enter') {
    if (state === 'title') startPlaying();
    else if (state === 'results') retry();
  }
};
hud.pause.addEventListener('click', () => state === 'playing' && setState('paused'));
screens.resume.addEventListener('click', togglePause);
screens.restart.addEventListener('click', () => {
  newRun();
  startPlaying();
});
screens.retry.addEventListener('click', retry);
screens.fullscreen.addEventListener('click', () => {
  const d = document as Document & { webkitFullscreenElement?: Element; webkitExitFullscreen?: () => void };
  const r = root as HTMLElement & { webkitRequestFullscreen?: () => void };
  try {
    if (document.fullscreenElement || d.webkitFullscreenElement) void (document.exitFullscreen?.() ?? d.webkitExitFullscreen?.());
    else if (r.requestFullscreen) void r.requestFullscreen().catch(() => undefined);
    else r.webkitRequestFullscreen?.();
  } catch {
    // not allowed (iframe without allowfullscreen, iOS): the button just does nothing
  }
});
// alt-tab, a notification, a call, a click outside the itch iframe: pause (input resets itself)
window.addEventListener('blur', () => state === 'playing' && setState('paused'));
document.addEventListener('visibilitychange', () => {
  if (document.hidden && state === 'playing') setState('paused');
  audio.setRunning(!document.hidden && state !== 'paused');
});

// ---------- game events -> popups ----------
const scr = { x: 0, y: 0 };
const popup = (kind: PopupKind, text: string, lift: number): void => popups.show(kind, text, lift);
bus.on('land', (e) => {
  hud.landed(e.kind);
  if (run.flightK > 0) return; // the scripted island landing has its own popup (islandLand)
  if (e.kind === 'great') popup('great', e.streak > 1 ? `GREAT x${e.streak}` : 'GREAT!', 105);
  else if (e.kind === 'ok') popup('nice', 'NICE', 80); // GOOD: the streak is kept
  else if (e.kind === 'splash') popup('splash', 'SPLASH!', 90);
  // BAD: no text — the thud and the streak dots resetting say it
});
bus.on('points', (e) => popup('points', `+${e.amount}`, 50));
// hit-stop: a short render-only freeze on big GREAT streaks
let hitStop = 0;
bus.on('land', (e) => {
  if (e.kind === 'great' && e.streak >= CONFIG.juice.hitStopStreak && botPolicy === null) hitStop = CONFIG.juice.hitStop;
});
bus.on('feverStart', () => popup('fever', 'FEVER!', 170));

// ---------- extra juice: screen flash + camera shake on the big moments ----------
const flashEl = el('div', 'flash', uiRoot);
function flash(alpha: number, color = '#fff'): void {
  if (botPolicy !== null) return;
  flashEl.style.transition = 'none';
  flashEl.style.background = color;
  flashEl.style.opacity = String(alpha);
  void flashEl.offsetWidth; // restart the fade
  flashEl.style.transition = 'opacity 0.35s ease-out';
  flashEl.style.opacity = '0';
}
bus.on('feverStart', () => {
  flash(CONFIG.juice.flashFever, '#FFF3B0');
  renderer.rig.shake(CONFIG.camera.shakeFever);
});
bus.on('speedTier', (e) => e.tier > e.prev && e.tier >= 2 && flash(CONFIG.juice.flashTier));
bus.on('land', (e) => {
  if (e.kind === 'great' && e.streak >= 3) renderer.rig.shake(CONFIG.camera.shakeGreat * Math.min(3, e.streak / 3));
});
bus.on('islandLand', (e) => {
  renderer.rig.shake(CONFIG.camera.shakeIsland);
  if (e.kind === 'great') flash(CONFIG.juice.flashIsland, '#FFE14D');
});
bus.on('skyTouch', () => popup('sky', 'SKY TOUCH!', 120));
bus.on('coin', (e) => e.type === 'blue' && popup('boost', 'BOOST!', 85));
/** Banner of island k: number, style and palette names. */
function islandBanner(k: number): void {
  if (jump.banner === k) return;
  jump.banner = k;
  const isl = run.world.islands[k - 1];
  popups.showBanner(`ISLAND ${k}`, isl ? `${islandStyle(k).name} · ${CONFIG.palettes[isl.palette].name}` : '');
}
bus.on('island', (e) => islandBanner(e.index));

// ---------- island jump: slow-mo around the apex, banner + sting at the apex, touchdown juice ----------
const jump = { on: false, k: 0, apexX: 0, tApex: 0, apexDone: false, banner: 0, t0: -1, tLand: -1 };
bus.on('islandLaunch', (e) => {
  jump.on = true;
  jump.k = e.k;
  jump.apexX = e.apexX;
  jump.tApex = run.t + (e.duration * (e.apexX - e.x)) / Math.max(1, e.targetX - e.x);
  jump.apexDone = false;
  jump.t0 = run.t;
});
bus.on('islandLand', (e) => {
  jump.on = false;
  jump.tLand = run.t;
  if (e.kind === 'great') popup('perfect', 'PERFECT LANDING!', 150);
  hitStop = Math.max(hitStop, CONFIG.juice.islandHitStop);
});
/** Time scale of the frame: eased dip to slowMo around the apex (by sim time: deterministic pacing). */
function slowMo(): number {
  const J = CONFIG.juice;
  if (!jump.on || state !== 'playing') return 1;
  const d = Math.abs(run.t - jump.tApex) - J.slowMoTime / 2;
  const w = d <= 0 ? 1 : d >= J.slowMoEase ? 0 : 1 - (d / J.slowMoEase) * (d / J.slowMoEase) * (3 - (2 * d) / J.slowMoEase);
  return 1 - (1 - J.slowMo) * w;
}
bus.on('caught', () => setState('caught'));
const lastLand = { kind: '', t: -1 };
bus.on('land', (e) => {
  lastLand.kind = e.kind;
  lastLand.t = run.t;
});

// ---------- loop ----------
function step(): void {
  const held = bot ? bot.tick(run.bird) : input.held;
  run.step(held);
  stepsThisFrame++;
}

let debug: { frame(dt: number, steps: number, zoom: number, held: boolean): void; refresh(): void } | null = null;
if (debugOn)
  void import('./debug/debug').then(({ Debug }) => {
    debug = new Debug(root, () => run, { restart: () => (newRun(), startPlaying()) });
  });

// ?tune=1: curated feel panel (dev and production builds). In dev, T opens it even without the flag.
let tune: TunePanel | null = null;
let tuneLoading = false;
function loadTune(open: boolean): void {
  if (tune || tuneLoading) return;
  tuneLoading = true;
  void import('./ui/tune').then(({ TunePanel }) => {
    tune = new TunePanel(uiRoot, {
      run: () => run,
      zoom: () => renderer.rig.z,
      restart,
      randomSeed,
      changed: () => debug?.refresh(),
      toScreen: (x, y, out) => renderer.toScreen(x, y, out),
    });
    if (open) tune.toggle(true);
  });
}
if (tuneOn) loadTune(false);

// dev: saving tuning.json applies it in every open tab (phone over LAN too) without a reload.
// Physics/camera are live on the next step; a world change (hills/islands/gRelease) restarts the same seed.
if (import.meta.hot)
  import.meta.hot.accept('../tuning.json', (mod) => {
    if (!mod) return;
    const before = worldKey();
    applyTuning(parseTuning(mod.default));
    if (worldKey() !== before) restart(run.seed);
    tune?.sync();
    debug?.refresh();
    console.info('[tuning] tuning.json applied');
  });

let frames = 0;
let elapsed = 0;
function frame(dt: number, alpha: number): void {
  loop.timeScale = slowMo();
  dt *= loop.timeScale; // render time follows the slow-mo too
  stateT += dt;
  if (jump.on && !jump.apexDone && run.cx >= jump.apexX) {
    jump.apexDone = true;
    islandBanner(jump.k + 1);
    audio.sting();
  }
  frames++;
  elapsed += dt;
  if (state === 'caught' && stateT >= CONFIG.night.caughtTime) setState('results');
  if (state === 'results') screens.setRetryLocked(stateT < CONFIG.ui.retryLock);
  if (bot && state === 'title' && stateT >= CONFIG.bot.autoStart) startPlaying();
  if (bot && state === 'results' && stateT >= CONFIG.bot.autoRetry) retry();

  const asleep = state === 'title' || state === 'caught' || state === 'results';
  if (state === 'playing' && stateT > 1 && quality.update(dt)) {
    renderer.setQuality(quality.dpr, quality.particles, quality.grain);
    resize();
  }
  teacher.update(dt, run, teachCur, state === 'playing');
  renderer.teacher = teacher.alpha;
  // during a hit-stop the canvas keeps its last image; the sim keeps stepping
  if (hitStop > 0) hitStop -= dt;
  else renderer.frame(dt, alpha, asleep, state === 'playing');
  audio.frame(run.speed, !run.bird.grounded && run.held && run.flightK === 0, state === 'playing', renderer.rig.cine);
  hud.update(dt, run, renderer.skyState);
  renderer.toScreen(renderer.bx, renderer.by, scr);
  const u = renderer.layout.gw / renderer.layout.logW;
  popups.update(dt, scr.x, scr.y, u, renderer.layout.gw);
  if (state === 'title' || state === 'results') {
    screens.zzz.style.left = `${scr.x + 26 * u}px`;
    screens.zzz.style.top = `${scr.y - 90 * u}px`;
  }
  debug?.frame(dt, stepsThisFrame, renderer.rig.z, run.held);
  tune?.frame(dt);
  stepsThisFrame = 0;
}

const loop = new Loop(step, frame);
renderer.onBump = () => audio.bump();
renderer.fx.onSonic = () => {
  renderer.rig.shake(CONFIG.camera.shakeSonic);
  audio.boom();
};

function resize(): void {
  const vv = window.visualViewport;
  const W = Math.round(vv ? vv.width : innerWidth), H = Math.round(vv ? vv.height : innerHeight);
  const L = renderer.resize(W, H, coarse);
  Object.assign(uiRoot.style, { left: `${L.gx}px`, top: `${L.gy}px`, width: `${L.gw}px`, height: `${L.gh}px` });
  uiRoot.style.setProperty('--u', String(L.gw / L.logW));
  rotated = L.landscapePhone;
  screens.setRotate(rotated);
  if (rotated && state === 'playing') setState('paused');
}
new ResizeObserver(resize).observe(root);
window.visualViewport?.addEventListener('resize', resize);
resize();
setState('title');
loop.start();

// hooks for tools/shot.ts
(window as unknown as { __sd: unknown }).__sd = {
  state: () => state,
  run: () => run,
  renderer,
  fps: () => (elapsed > 0 ? frames / elapsed : 0),
  lastLand: () => lastLand,
  quality: () => quality.level,
  jump: () => jump,
  cine: () => renderer.rig.cine,
  held: () => input.held,
  overWater: () => run.world.islands.some((i) => run.bird.x > i.lipX && run.bird.x < i.landingX && !run.bird.grounded),
};
