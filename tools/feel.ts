// npm run feel — headless FEEL metrics on the real game (islands terrain, real sim + real camera rig, 60 fps).
//   npm run feel                 all presets + 'tuning' (= tuning.json, what ships)
//   npm run feel -- smooth rush  only these presets ('tuning' = tuning.json)
//   FEEL_TUNING=path.json npm run feel -- tuning   another tuning file (try a candidate before saving it)
//   FEEL_SET="camera.wX=6,physics.diveRamp=0.04" npm run feel -- smooth   override any CONFIG number (after the preset)
// Columns:
//   takeoffs/s   real takeoffs per second (v1 chattered at 9-16/s; healthy < 1.5)
//   birdJ p99    2nd difference of the bird's SCREEN position, px/frame^2 (landing impacts are physical)
//   camJ p99     camera-induced jerk at the bird (world scroll + zoom), px/frame^2 — the "shake" you feel
//   camJ>2       frames with camera jerk > 2 px/frame^2 per 90 s (healthy: <= 5)
//   zoom p99     |d ln z / dt| — how fast the view breathes (healthy: < 0.8)
//   drift p99    |bird screen x - anchor|, logical px — how far the smoothed camera lets the bird wander
//   relief p50   on-screen terrain relief (max h - min h across the view) x zoom, logical px of 1280:
//                how big the hills LOOK. 'relief isl4+' = the same on island 4 and later (zoomed out, fast)
import { readFileSync } from 'node:fs';
import { CONFIG, PHYSICS_PRESETS, type PresetName } from '../src/config';
import { EventBus, type GameEvents } from '../src/core/events';
import { CameraRig } from '../src/render/camera';
import { EV_LAND, EV_TAKEOFF } from '../src/sim/bird';
import { Bot, type BotPolicy } from '../src/sim/bot';
import { Run } from '../src/sim/run';
import { applyTuning, emptyTuning, parseTuning } from '../src/tuning';

const SEEDS = (process.env.FEEL_SEEDS ?? '3,9,21').split(',').map(Number);
const T = 90;
const ALL_BOTS: [string, BotPolicy, number][] = [
  ['naive', 'naive', 0], // new player
  ['p100', 'planner', 6], // planner with 100 ms reaction
  ['p50', 'planner', 3], // good player
  ['pro', 'planner', 0], // perfect timing (not guarded: no human plays like this)
];
const BOTS = process.env.FEEL_BOTS ? ALL_BOTS.filter((b) => process.env.FEEL_BOTS!.split(',').includes(b[0])) : ALL_BOTS;

interface Row {
  surv: number;
  island: number;
  v50: number;
  takeoffs: number;
  landings: number;
  great: number;
  birdJ: number;
  camJ: number;
  camSpikes: number;
  zoom: number;
  drift: number;
  relief: number;
  reliefLate: number;
}

const q = (a: number[], p: number): number => {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? s[Math.floor(p * (s.length - 1))] : 0;
};

function one(policy: BotPolicy, delay: number, seed: number): Row {
  const bus = new EventBus<GameEvents>();
  const run = new Run(seed, 'islands', bus);
  const bot = new Bot(run.world.terrain, policy, delay);
  const rig = new CameraRig();
  // the island-jump flight shot is part of the camera the player sees
  bus.on('islandLaunch', (e) => rig.flightStart(e));
  bus.on('islandLand', () => rig.flightEnd());
  const cur = run.world.terrain.cursor();
  const rc = run.world.terrain.cursor();
  const relief: number[] = [], reliefLate: number[] = [];
  const W = CONFIG.view.logW, Hh = CONFIG.view.logH, fdt = 1 / 60;
  const spf = Math.round(fdt / CONFIG.physics.dt);
  const bird: number[][] = [], cam: number[][] = [], speeds: number[] = [];
  let takeoffs = 0, landings = 0, great = 0;
  run.start();
  for (let f = 0; f < T * 60 && !run.over; f++) {
    for (let k = 0; k < spf && !run.over; k++) {
      run.step(bot.tick(run.bird));
      const b = run.bird;
      if (b.ev === EV_TAKEOFF) takeoffs++;
      if (b.ev === EV_LAND) {
        landings++;
        if (b.evKind === 'great') great++;
      }
    }
    const b = run.bird;
    cur.sample(b.grounded ? b.u : b.x);
    const vx = b.grounded ? b.v / Math.hypot(1, cur.d1) : b.vx;
    rig.update(fdt, run.cx, run.cy, run.speed, vx, cur, W, Hh, f === 0, run.world.islands);
    cam.push([rig.cx, rig.cy, rig.z, rig.viewW, rig.viewH, rig.anchor]);
    bird.push([run.cx, run.cy]);
    if (f % 6 === 0) {
      let lo = Infinity, hi = -Infinity;
      for (let x = rig.cx - rig.viewW / 2, x1 = rig.cx + rig.viewW / 2; x <= x1; x += 16) {
        const y = rc.height(x);
        if (y < lo) lo = y;
        if (y > hi) hi = y;
      }
      (run.island >= 4 ? reliefLate : relief).push((hi - lo) * rig.z);
    }
    speeds.push(run.speed);
  }
  const scr = (i: number, P: number[]): number[] => {
    const c = cam[i];
    return [((P[0] - (c[0] - c[3] / 2)) / c[3]) * W, (1 - (P[1] - (c[1] - c[4] / 2)) / c[4]) * Hh];
  };
  const bj: number[] = [], cj: number[] = [], zr: number[] = [], dr: number[] = [];
  for (let i = 1; i < bird.length - 1; i++) {
    const a = scr(i - 1, bird[i - 1]), m = scr(i, bird[i]), c = scr(i + 1, bird[i + 1]);
    bj.push(Math.hypot(a[0] - 2 * m[0] + c[0], a[1] - 2 * m[1] + c[1]));
    const P = bird[i], p0 = scr(i - 1, P), p1 = scr(i, P), p2 = scr(i + 1, P);
    cj.push(Math.hypot(p0[0] - 2 * p1[0] + p2[0], p0[1] - 2 * p1[1] + p2[1]));
    zr.push(Math.abs(Math.log(cam[i + 1][2] / cam[i][2])) * 60);
    dr.push(Math.abs(m[0] - cam[i][5] * W));
  }
  const secs = bird.length / 60;
  return {
    surv: secs,
    island: run.island,
    v50: q(speeds, 0.5),
    takeoffs: takeoffs / Math.max(1, secs),
    landings,
    great: landings ? great / landings : 0,
    birdJ: q(bj, 0.99),
    camJ: q(cj, 0.99),
    camSpikes: (cj.filter((x) => x > 2).length * 90) / Math.max(1, secs),
    zoom: q(zr, 0.99),
    drift: q(dr, 0.99),
    relief: q([...relief, ...reliefLate], 0.5),
    reliefLate: reliefLate.length ? q(reliefLate, 0.5) : NaN,
  };
}

function overrides(): void {
  for (const kv of (process.env.FEEL_SET ?? '').split(',').filter(Boolean)) {
    const [path, val] = kv.split('=');
    const keys = path.trim().split('.');
    let o = CONFIG as unknown as Record<string, unknown>;
    for (const k of keys.slice(0, -1)) o = o[k] as Record<string, unknown>;
    o[keys[keys.length - 1]] = Number(val);
  }
}

const want = process.argv.slice(2).filter((a) => a in PHYSICS_PRESETS || a === 'tuning');
const presets = want.length ? want : [...Object.keys(PHYSICS_PRESETS), 'tuning'];
const tuningPath = process.env.FEEL_TUNING ?? 'tuning.json';
const out: Record<string, string | number>[] = [];
let worstTakeoff = 0, worstCam = 0, worstZoom = 0;
for (const p of presets) {
  if (p === 'tuning') applyTuning(parseTuning(JSON.parse(readFileSync(tuningPath, 'utf8'))));
  else applyTuning(emptyTuning(p as PresetName)); // pure preset on CONFIG defaults
  overrides();
  const label = p === 'tuning' ? `${tuningPath.replace(/^.*[\/]/, '')}(${CONFIG.physicsPreset})` : p;
  for (const [name, policy, delay] of BOTS) {
    const rs = SEEDS.map((s) => one(policy, delay, s));
    const avg = (k: keyof Row): number => rs.reduce((a, r) => a + r[k], 0) / rs.length;
    if (name !== 'pro') {
      worstTakeoff = Math.max(worstTakeoff, avg('takeoffs'));
      worstCam = Math.max(worstCam, avg('camSpikes'));
      worstZoom = Math.max(worstZoom, avg('zoom'));
    }
    out.push({
      preset: label,
      bot: name,
      'survived s': Math.round(avg('surv')),
      island: +avg('island').toFixed(1),
      'v p50': Math.round(avg('v50')),
      'takeoffs/s': +avg('takeoffs').toFixed(2),
      landings: Math.round(avg('landings')),
      GREAT: `${Math.round(avg('great') * 100)}%`,
      'birdJ p99': +avg('birdJ').toFixed(2),
      'camJ p99': +avg('camJ').toFixed(2),
      'camJ>2': Math.round(avg('camSpikes')),
      'zoom p99': +avg('zoom').toFixed(2),
      'drift p99': Math.round(avg('drift')),
      'relief p50': Math.round(avg('relief')),
      'relief isl4+': Number.isNaN(avg('reliefLate')) ? '—' : Math.round(avg('reliefLate')),
    });
  }
}
console.log(`\nFeel metrics — islands terrain, ${T} s, seeds ${SEEDS.join('/')} (averages)\n`);
console.table(out);
const ok = worstTakeoff < 1.5 && worstCam <= 5 && worstZoom < 0.8;
console.log(
  `\nFEEL GUARDS: takeoffs/s max ${worstTakeoff.toFixed(2)} (<1.5)  camJ>2 max ${worstCam.toFixed(0)} (<=5)  zoom p99 max ${worstZoom.toFixed(2)} (<0.8)  -> ${ok ? 'PASS' : 'FAIL'}`,
);
process.exitCode = ok ? 0 : 1;
