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
import { loadRecords, submitRecords } from './core/records';
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
import { Tutorial } from './ui/tutorial';
import { Settings } from './ui/settings';
import { Tilt } from './core/tilt';
import { RaceRun } from './sim/race';
import { RaceUI } from './ui/race';
import { load, save } from './core/storage';
import type { TunePanel } from './ui/tune';
import type { TerrainMode } from './world/world';

// tuning.json is what ships: preset + overrides, applied before anything reads CONFIG.
applyTuning(parseTuning(tuningFile));

// Bootstrap, resize and the state machine: Title -> Playing <-> Paused -> Caught -> Results -> Playing.
type State = 'title' | 'playing' | 'paused' | 'caught' | 'results' | 'raceMenu' | 'countdown' | 'raceEnd';

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
const tutorial = new Tutorial(uiRoot);
let tutorialOpen = false;
/** First tap on the title: the "how to fly" card once (never with the bot), then the run. */
function begin(): void {
  if (botPolicy === null && load('tutorialSeen') !== '1') openTutorial();
  else startPlaying();
}
function openTutorial(): void {
  tutorialOpen = true;
  tutorial.show(true);
  screens.showOnly(null);
}
tutorial.close.addEventListener('click', () => {
  save('tutorialSeen', '1');
  tutorialOpen = false;
  tutorial.show(false);
  if (state === 'title') startPlaying();
});
screens.help.addEventListener('click', openTutorial);

// ---------- settings + tilt control ----------
const tilt = new Tilt();
input.tilt = tilt;
const settings = new Settings(uiRoot, tilt, {
  get muted() {
    return audio.muted;
  },
  toggle: () => {
    audio.unlock();
    audio.setMuted(!audio.muted);
    syncSound();
  },
});
screens.gear.addEventListener('click', () => settings.show(true));
screens.pauseSettings.addEventListener('click', () => settings.show(true));
screens.toMenu.addEventListener('click', () => {
  // leave the run / race: a fresh endless world behind the title
  if (race) endRaceMode();
  else newRun();
  setState('title');
});
const tiltInd = el('div', 'tilt-ind', uiRoot, 'TILT');
// tilt chosen last time: re-enable on the first tap (iOS asks for permission inside a gesture)
if (load('control') === 'tilt' && Tilt.available())
  window.addEventListener('pointerdown', () => void settings.enableTilt(), { once: true, capture: true });
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
  syncSound();
});
// WebAudio needs a user gesture (iOS: inside touchend/pointerdown): unlock on every gesture
for (const type of ['pointerdown', 'touchend', 'keydown'])
  window.addEventListener(type, () => audio.unlock(), { capture: true, passive: true });
let run = new Run(newSeed(), mode, bus);
let bot = botPolicy ? new Bot(run.world.terrain, botPolicy, botDelay) : null;
renderer.setRun(run);
let teachCur = run.world.terrain.cursor();
/** Race mode (null = the endless run). */
let race: RaceRun | null = null;
const raceUI = new RaceUI(uiRoot);
let countShown = -9;

const records = loadRecords();
let best = records.score;
let recordShown = false;
screens.setBest(best);
let state: State = 'title';
let stateT = 0;
let stepsThisFrame = 0;
let rotated = false;

function setState(s: State): void {
  state = s;
  stateT = 0;
  audio.setRunning(s !== 'paused' && !document.hidden);
  loop.simulate = s === 'playing';
  hud.show((s === 'playing' || s === 'paused' || s === 'caught' || s === 'countdown') && !race);
  raceUI.showHud(!!race && (s === 'playing' || s === 'paused' || s === 'countdown'));
  screens.showOnly(s === 'title' ? screens.title : s === 'paused' ? screens.pause : s === 'results' ? screens.results : null);
  raceUI.menu.classList.toggle('visible', s === 'raceMenu');
  raceUI.results.classList.toggle('visible', s === 'raceEnd');
  if (s === 'raceMenu') raceUI.fillMenu();
  if (s === 'raceEnd' && race) {
    const medal = raceUI.fillResults(race);
    audio.finish(race.place === 1, medal);
  }
  if (s === 'results') {
    const total = Math.floor(run.score.total);
    const isNew = total > best;
    const sc = run.score;
    const broken = submitRecords(records, {
      score: total,
      meters: Math.floor(sc.meters),
      island: run.island,
      chain: sc.maxStreak,
      kmh: Math.round(sc.maxSpeed * CONFIG.speed.kmhPerPx),
    });
    best = records.score;
    screens.setBest(best);
    renderer.flag.x = records.meters * CONFIG.speed.pxPerMeter;
    screens.fillResults(run, best, isNew, broken);
    screens.setRetryLocked(true);
  }
}

/** Race: build the track + rivals and count down. */
function startRace(track: number): void {
  race = new RaceRun(track, bus);
  run = race.run;
  bot = botPolicy ? new Bot(run.world.terrain, botPolicy, botDelay) : null;
  renderer.setRun(run);
  renderer.setRace(race);
  renderer.flag.x = 0;
  teachCur = run.world.terrain.cursor();
  popups.clear();
  countShown = -9;
  setState('countdown');
}

/** Leave the race mode: an endless run behind the menus again. */
function endRaceMode(): void {
  race = null;
  renderer.setRace(null);
  newRun();
  renderer.flag.x = records.meters * CONFIG.speed.pxPerMeter;
}
screens.raceBtn.addEventListener('click', () => setState('raceMenu'));
raceUI.onPick = (i) => startRace(i);
raceUI.back.addEventListener('click', () => setState('title'));
raceUI.again.addEventListener('click', () => race && startRace(race.track));
raceUI.toMenu.addEventListener('click', () => {
  endRaceMode();
  setState('raceMenu');
});

function newRun(seed = newSeed()): void {
  jump.on = false;
  jump.banner = 0;
  jump.t0 = jump.tLand = -1;
  run = new Run(seed, mode, bus);
  bot = botPolicy ? new Bot(run.world.terrain, botPolicy, botDelay) : null;
  renderer.setRun(run);
  teachCur = run.world.terrain.cursor();
  popups.clear();
  recordShown = false;
}

function startPlaying(): void {
  if (tilt.enabled) tilt.calibrate(); // the angle the player holds the phone at = neutral
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
  if (state === 'title' && !rotated && !tutorialOpen && !settings.open) begin();
  else if (state === 'results' && kind === 'key') retry();
};
input.onKey = (code) => {
  if (tune?.key(code)) return;
  if (code === 'KeyT' && import.meta.env.DEV) return loadTune(true);
  if (code === 'Escape' || code === 'KeyP') togglePause();
  else if (code === 'Enter') {
    if (state === 'title' && !tutorialOpen) begin();
    else if (state === 'results') retry();
  }
};
hud.pause.addEventListener('click', () => state === 'playing' && setState('paused'));
screens.resume.addEventListener('click', togglePause);
screens.restart.addEventListener('click', () => {
  if (race) return startRace(race.track);
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
bus.on('caught', () => {
  setState('caught');
  popups.showBanner('GOOD NIGHT', 'the night caught up');
});
bus.on('land', (e) => teacher.landed(e.kind));
bus.on('dayGain', (e) => popup('day', `+${Math.round(e.amount)}s DAY`, 150));
bus.on('nightNear', () => audio.warn());
const lastLand = { kind: '', t: -1 };
bus.on('land', (e) => {
  lastLand.kind = e.kind;
  lastLand.t = run.t;
});

// ---------- loop ----------
function step(): void {
  const held = bot ? bot.tick(run.bird) : input.held;
  if (race) race.step(held);
  else run.step(held);
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
  // passing the record distance: the hook to try again
  if (!recordShown && records.meters > 50 && state === 'playing' && run.score.meters > records.meters) {
    recordShown = true;
    popup('record', 'NEW RECORD!', 190);
    audio.record();
  }
  if (jump.on && !jump.apexDone && run.cx >= jump.apexX) {
    jump.apexDone = true;
    islandBanner(jump.k + 1);
    audio.sting();
  }
  frames++;
  elapsed += dt;
  if (state === 'caught' && stateT >= CONFIG.night.caughtTime) setState('results');
  // race: countdown, live HUD, ring boosts, the end
  if (race) {
    if (state === 'countdown') {
      const n = Math.ceil(CONFIG.race.countdown - stateT);
      if (n !== countShown) {
        countShown = n;
        raceUI.countdown(Math.max(0, n));
        audio.beep(n <= 0);
      }
      if (stateT >= CONFIG.race.countdown) {
        race.start();
        setState('playing');
      }
    } else if (stateT > 0.7 && countShown <= 0) raceUI.countdown(-1);
    if (race.ringHit >= 0) {
      race.ringHit = -1;
      popup('boost', 'RING BOOST!', 110);
      audio.ring();
    }
    if (state === 'playing' && race.done) setState('raceEnd');
    if (bot && state === 'raceEnd' && stateT >= CONFIG.bot.autoRetry) startRace(race.track);
  }
  if (state === 'results') screens.setRetryLocked(stateT < CONFIG.ui.retryLock);
  if (bot && state === 'title' && stateT >= CONFIG.bot.autoStart) startPlaying();
  if (bot && state === 'results' && stateT >= CONFIG.bot.autoRetry) retry();

  const asleep = state === 'title' || state === 'caught' || state === 'results';
  if (state === 'playing' && stateT > 1 && quality.update(dt)) {
    renderer.setQuality(quality.dpr, quality.particles, quality.grain);
    resize();
  }
  teacher.update(dt, run, teachCur, state === 'playing' && !race);
  renderer.teacher = teacher.alpha;
  // during a hit-stop the canvas keeps its last image; the sim keeps stepping
  if (hitStop > 0) hitStop -= dt;
  else renderer.frame(dt, alpha, asleep, state === 'playing');
  audio.frame(run.speed, !run.bird.grounded && run.held && run.flightK === 0, state === 'playing', renderer.rig.cine);
  if (race && (state === 'playing' || state === 'countdown')) raceUI.update(race, (x, y, o) => renderer.toScreen(x, y, o), renderer.layout.gw, renderer.layout.gh);
  else hud.update(dt, run, renderer.skyState);
  renderer.toScreen(renderer.bx, renderer.by, scr);
  const u = renderer.layout.gw / renderer.layout.logW;
  popups.update(dt, scr.x, scr.y, u, renderer.layout.gw);
  if (state === 'title' || state === 'results') {
    screens.zzz.style.left = `${scr.x + 26 * u}px`;
    screens.zzz.style.top = `${scr.y - 90 * u}px`;
  }
  debug?.frame(dt, stepsThisFrame, renderer.rig.z, run.held);
  tiltInd.style.display = tilt.enabled && state === 'playing' ? '' : 'none';
  tiltInd.classList.toggle('on', tilt.pressed);
  tune?.frame(dt);
  stepsThisFrame = 0;
}

const loop = new Loop(step, frame);
renderer.onBump = () => audio.bump();
renderer.flag.x = records.meters * CONFIG.speed.pxPerMeter;
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
  race: () => race,
  startRace,
  jump: () => jump,
  cine: () => renderer.rig.cine,
  held: () => input.held,
  overWater: () => run.world.islands.some((i) => run.bird.x > i.lipX && run.bird.x < i.landingX && !run.bird.grounded),
};
