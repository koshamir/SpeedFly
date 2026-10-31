import '@fontsource/lilita-one/latin-400.css';
import '@fontsource/fredoka/latin-500.css';
import '@fontsource/fredoka/latin-600.css';
import './ui/styles.css';
import tuningFile from '../tuning.json';
import { CONFIG } from './config';
import { EventBus, type GameEvents } from './core/events';
import { Input } from './core/input';
import { Loop } from './core/loop';
import { load, save } from './core/storage';
import { Renderer } from './render/renderer';
import { Bot, type BotPolicy } from './sim/bot';
import { Run } from './sim/run';
import { Hud } from './ui/hud';
import { Popups, type PopupKind } from './ui/popups';
import { applyTuning, parseTuning, worldKey } from './tuning';
import { Screens } from './ui/screens';
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
const input = new Input(root);
const hud = new Hud(uiRoot);
const popups = new Popups(uiRoot);
const screens = new Screens(uiRoot);
let run = new Run(newSeed(), mode, bus);
let bot = botPolicy ? new Bot(run.world.terrain, botPolicy, botDelay) : null;
renderer.setRun(run);

let best = Number(load('best')) || 0;
screens.setBest(best);
let state: State = 'title';
let stateT = 0;
let stepsThisFrame = 0;
let rotated = false;

function setState(s: State): void {
  state = s;
  stateT = 0;
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
    screens.setRetryLocked(true);
  }
}

function newRun(seed = newSeed()): void {
  run = new Run(seed, mode, bus);
  bot = botPolicy ? new Bot(run.world.terrain, botPolicy, botDelay) : null;
  renderer.setRun(run);
  popups.clear();
}

function startPlaying(): void {
  run.start();
  setState('playing');
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
document.addEventListener('visibilitychange', () => {
  if (document.hidden && state === 'playing') setState('paused');
});

// ---------- game events -> popups ----------
const scr = { x: 0, y: 0 };
const popup = (kind: PopupKind, text: string, lift: number): void => popups.show(kind, text, lift);
bus.on('land', (e) => {
  if (e.kind === 'great') popup('great', e.streak > 1 ? `GREAT x${e.streak}` : 'GREAT!', 105);
  else if (e.kind === 'splash') popup('splash', 'SPLASH!', 90);
});
bus.on('points', (e) => popup('points', `+${e.amount}`, 50));
bus.on('feverStart', () => popup('fever', 'FEVER!', 170));
bus.on('skyTouch', () => popup('sky', 'SKY TOUCH!', 120));
bus.on('coin', (e) => e.type === 'blue' && popup('boost', 'BOOST!', 85));
bus.on('island', (e) => popups.showBanner(`ISLAND ${e.index}`));
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
  stateT += dt;
  frames++;
  elapsed += dt;
  if (state === 'caught' && stateT >= CONFIG.night.caughtTime) setState('results');
  if (state === 'results') screens.setRetryLocked(stateT < CONFIG.ui.retryLock);
  if (bot && state === 'title' && stateT >= CONFIG.bot.autoStart) startPlaying();
  if (bot && state === 'results' && stateT >= CONFIG.bot.autoRetry) retry();

  const asleep = state === 'title' || state === 'caught' || state === 'results';
  renderer.frame(dt, alpha, asleep, state === 'playing');
  hud.update(run, renderer.skyState);
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
  overWater: () => run.world.islands.some((i) => run.bird.x > i.lipX && run.bird.x < i.landingX && !run.bird.grounded),
};
