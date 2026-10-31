// npm run gameplay — the micro-loop in numbers: how high and fast bots of different skill fly, how far
// one flight carries (in hills), how the landing judge rates them, how far they get before the night.
//   npm run gameplay                      tuning.json (what ships)
//   npm run gameplay -- tw smooth         these presets instead
//   GP_SET="physics.vSoft=1800,hills.height=190" npm run gameplay   try numbers without saving
import { readFileSync } from 'node:fs';
import { applyPreset, CONFIG, PHYSICS_PRESETS, type PresetName } from '../src/config';
import { EventBus, type GameEvents } from '../src/core/events';
import { EV_LAND } from '../src/sim/bird';
import { Bot, type BotPolicy } from '../src/sim/bot';
import { Run } from '../src/sim/run';
import { applyTuning, parseTuning } from '../src/tuning';

const SEEDS = (process.env.GP_SEEDS ?? '3,9,21').split(',').map(Number);
const T = Number(process.env.GP_T ?? 180);
const BOTS: [string, BotPolicy, number][] = [
  ['naive', 'naive', 0],
  ['p100', 'planner', 6],
  ['p50', 'planner', 3],
  ['pro', 'planner', 0],
];

function set(): void {
  for (const kv of (process.env.GP_SET ?? '').split(',').filter(Boolean)) {
    const [path, val] = kv.split('=');
    const keys = path.trim().split('.');
    let o = CONFIG as unknown as Record<string, unknown>;
    for (const k of keys.slice(0, -1)) o = o[k] as Record<string, unknown>;
    o[keys[keys.length - 1]] = Number(val);
  }
}

const q = (a: number[], p: number): number => {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? s[Math.floor(p * (s.length - 1))] : 0;
};

function one(policy: BotPolicy, delay: number, seed: number) {
  const bus = new EventBus<GameEvents>();
  const run = new Run(seed, 'islands', bus);
  const bot = new Bot(run.world.terrain, policy, delay);
  let great = 0, good = 0, bad = 0, splash = 0, streakMax = 0, launchT = 0;
  const apex: number[] = [], hills: number[] = [], speeds: number[] = [], descents: number[] = [], flights: number[] = [];
  let dIdx = 0, dT0 = -1, fT0 = -1, seqBad = 0;
  let skipNext = false;
  bus.on('islandLaunch', () => (launchT = run.t));
  bus.on('islandLand', () => (skipNext = true));
  run.start();
  for (let i = 0; i < T * 240 && !run.over; i++) {
    run.step(bot.tick(run.bird));
    const b = run.bird;
    if (i % 24 === 0) speeds.push(run.speed);
    // mountain descent time (summit -> valley) and island flight time
    const L = run.world.islands;
    if (dIdx < L.length) {
      const isl = L[dIdx];
      if (dT0 < 0 && b.x >= isl.summitX) dT0 = run.t;
      if (dT0 >= 0 && b.x >= isl.valleyX) {
        descents.push(run.t - dT0);
        dT0 = -1;
        dIdx++;
      }
    }
    if (run.flightK > 0 && fT0 < 0) fT0 = run.t;
    if (run.flightK === 0 && fT0 >= 0) {
      flights.push(run.t - fT0);
      fT0 = -1;
    }
    if (b.ev === EV_LAND && run.inSequence && (b.evKind === 'bad' || b.evKind === 'splash')) seqBad++;
    if (b.ev === EV_LAND && skipNext) skipNext = false; // the scripted island landing is not the player's
    else if (b.ev === EV_LAND && run.t - launchT > 0.05) {
      if (b.evKind === 'great') great++;
      else if (b.evKind === 'ok') good++;
      else if (b.evKind === 'bad') bad++;
      else splash++;
      apex.push(b.airAlt);
      hills.push(b.evFlight / CONFIG.hills.width);
      streakMax = Math.max(streakMax, b.streak);
    }
  }
  const n = Math.max(1, great + good + bad + splash);
  return {
    t: run.t, island: run.island, v50: q(speeds, 0.5), v90: q(speeds, 0.9), vmax: q(speeds, 1),
    ap50: q(apex, 0.5), ap90: q(apex, 0.9), apmax: q(apex, 1), h50: q(hills, 0.5), h90: q(hills, 0.9),
    flights: apex.length / Math.max(1, run.t) * 10, great: great / n, good: good / n, bad: bad / n, streakMax,
    fever: run.score.feverTime / Math.max(1, run.t), seqBad,
    dMin: descents.length ? Math.min(...descents) : NaN, dMax: descents.length ? Math.max(...descents) : NaN,
    fMin: flights.length ? Math.min(...flights) : NaN, fMax: flights.length ? Math.max(...flights) : NaN,
  };
}

const args = process.argv.slice(2).filter((a) => a in PHYSICS_PRESETS) as PresetName[];
const runs: [string, () => void][] = args.length
  ? args.map((p) => [p, () => applyPreset(p)])
  : [['tuning', () => applyTuning(parseTuning(JSON.parse(readFileSync('tuning.json', 'utf8'))))]];
const rows: Record<string, string | number>[] = [];
for (const [name, apply] of runs) {
  apply();
  set();
  for (const [bn, pol, d] of BOTS) {
    const rs = SEEDS.map((s) => one(pol, d, s));
    const a = (k: keyof ReturnType<typeof one>): number => rs.reduce((s, r) => s + (r[k] as number), 0) / rs.length;
    rows.push({
      cfg: name, bot: bn, 'alive s': Math.round(a('t')), island: +a('island').toFixed(1),
      'v p50/p90/max': `${Math.round(a('v50'))}/${Math.round(a('v90'))}/${Math.round(a('vmax'))}`,
      'apex p50/p90/max': `${Math.round(a('ap50'))}/${Math.round(a('ap90'))}/${Math.round(a('apmax'))}`,
      'hills/flight p50/p90': `${a('h50').toFixed(1)}/${a('h90').toFixed(1)}`,
      'flights/10s': +a('flights').toFixed(1),
      'GREAT/GOOD/BAD': `${Math.round(a('great') * 100)}/${Math.round(a('good') * 100)}/${Math.round(a('bad') * 100)}%`,
      'streak max': +a('streakMax').toFixed(1),
      'fever %': Math.round(a('fever') * 100),
      'descent s': `${Math.min(...rs.map((r) => r.dMin)).toFixed(1)}–${Math.max(...rs.map((r) => r.dMax)).toFixed(1)}`,
      'seq BAD': a('seqBad'),
      'flight s': `${Math.min(...rs.map((r) => r.fMin)).toFixed(1)}–${Math.max(...rs.map((r) => r.fMax)).toFixed(1)}`,
    });
  }
}
console.log(`\nGameplay — islands terrain, ${T} s, seeds ${SEEDS.join('/')} (averages; apex = px above the ground at landing-flight max)\n`);
console.table(rows);
