import './ui/styles.css';
import { CONFIG } from './config';
import { EventBus, type GameEvents } from './core/events';
import { Input } from './core/input';
import { Loop } from './core/loop';
import { Renderer } from './render/renderer';
import { Bot, type BotPolicy } from './sim/bot';
import { Run } from './sim/run';
import type { TerrainMode } from './world/world';

type State = 'title' | 'playing' | 'paused' | 'caught' | 'results';

const params = new URLSearchParams(location.search);
const debugOn = params.get('debug') === '1';
const botParam = params.get('bot');
const botPolicy: BotPolicy | null =
  botParam === null || botParam === '0' ? null : botParam === 'none' || botParam === 'always' || botParam === 'naive' ? botParam : 'planner';
const botDelay = Number(params.get('botDelay') ?? 0) | 0;
const fixedSeed = params.has('seed') ? Number(params.get('seed')) | 0 : null;
const mode: TerrainMode = params.get('terrain') === 'reference' ? 'reference' : 'islands';
const newSeed = (): number => fixedSeed ?? ((Math.random() * 0x7fffffff) | 0);

const root = document.getElementById('root')!;
const canvas = document.getElementById('game') as HTMLCanvasElement;
const uiRoot = document.getElementById('ui')!;
const coarse = matchMedia('(pointer: coarse)').matches;

const bus = new EventBus<GameEvents>();
const renderer = new Renderer(canvas, bus);
const input = new Input(root);
let run = new Run(newSeed(), mode, bus);
let bot = botPolicy ? new Bot(run.world.terrain, botPolicy, botDelay) : null;
renderer.setRun(run);

let state: State = 'title';
let stateT = 0;
let stepsThisFrame = 0;

const msg = document.createElement('div');
msg.className = 'm1-msg';
uiRoot.appendChild(msg);

function setState(s: State): void {
  state = s;
  stateT = 0;
  loop.simulate = s === 'playing';
  msg.textContent = s === 'title' ? 'Tap to start' : s === 'paused' ? 'Paused' : s === 'results' ? 'Night fell — tap' : '';
}

function newRun(): void {
  run = new Run(newSeed(), mode, bus);
  bot = botPolicy ? new Bot(run.world.terrain, botPolicy, botDelay) : null;
  renderer.setRun(run);
}

function startPlaying(): void {
  run.start();
  setState('playing');
}

input.onPress = () => {
  if (state === 'title') startPlaying();
  else if (state === 'paused') setState('playing');
  else if (state === 'results' && stateT > CONFIG.ui.retryLock) {
    newRun();
    startPlaying();
  }
};
input.onKey = (code) => {
  if ((code === 'Escape' || code === 'KeyP') && (state === 'playing' || state === 'paused')) setState(state === 'playing' ? 'paused' : 'playing');
};
document.addEventListener('visibilitychange', () => {
  if (document.hidden && state === 'playing') setState('paused');
});
bus.on('caught', () => setState('caught'));

function step(): void {
  const held = bot ? bot.tick(run.bird) : input.held;
  run.step(held);
  stepsThisFrame++;
}

let debug: { frame(dt: number, steps: number, zoom: number, held: boolean): void } | null = null;
if (debugOn)
  void import('./debug/debug').then(({ Debug }) => {
    debug = new Debug(root, () => run, { restart: () => (newRun(), startPlaying()) });
  });

function frame(dt: number, alpha: number): void {
  stateT += dt;
  if (state === 'caught' && stateT >= CONFIG.night.caughtTime) setState('results');
  if (bot && state === 'title' && stateT >= CONFIG.bot.autoStart) startPlaying();
  if (bot && state === 'results' && stateT >= CONFIG.bot.autoRetry) (newRun(), startPlaying());
  renderer.frame(dt, alpha);
  debug?.frame(dt, stepsThisFrame, renderer.rig.z, run.held);
  stepsThisFrame = 0;
}

const loop = new Loop(step, frame);

function resize(): void {
  const vv = window.visualViewport;
  const W = Math.round(vv ? vv.width : innerWidth), H = Math.round(vv ? vv.height : innerHeight);
  const L = renderer.resize(W, H, coarse);
  Object.assign(uiRoot.style, { left: `${L.gx}px`, top: `${L.gy}px`, width: `${L.gw}px`, height: `${L.gh}px` });
  uiRoot.style.setProperty('--u', String(L.gw / L.logW));
}
new ResizeObserver(resize).observe(root);
window.visualViewport?.addEventListener('resize', resize);
resize();
setState('title');
loop.start();

// hooks for tools/shot.ts
(window as unknown as { __sd: unknown }).__sd = { state: () => state, run: () => run, renderer };
