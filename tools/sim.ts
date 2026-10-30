// npm run sim — headless physics regression (SPEC §12): bots on ?terrain=reference, 240 s, seeds 7/11/23,
// physics v2 with the 'classic' preset (the model check is independent of the preset you play with).
// Checks every seed against the v2 table (15% tolerance).
//   --ref   also print reference/physics-sim.mjs (v1 contact-point model) for comparison (informational)
// Feel metrics (jerk, chatter, camera) and preset comparison: npm run feel.
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { applyPreset } from '../src/config';
import { runBot, type BotPolicy, type BotResult } from '../src/sim/bot';

const T = 240;
const SEEDS = [7, 11, 23];
const TOL = 0.15;

interface Spec {
  name: string;
  policy: BotPolicy;
  delay: number;
  night: [number, number] | 'survive';
  v: [number, number];
  great: [number, number] | null; // share of landings
}

// Physics v2 baseline ('classic' preset, measured 2026-10-30). "~x" values are given as [x, x].
const SPECS: Spec[] = [
  { name: 'none', policy: 'none', delay: 0, night: [22, 26], v: [275, 291], great: null },
  { name: 'always', policy: 'always', delay: 0, night: [31, 41], v: [278, 316], great: null },
  { name: 'naive', policy: 'naive', delay: 0, night: [51, 62], v: [519, 544], great: [0, 0.15] },
  { name: 'planner+100ms', policy: 'planner', delay: 6, night: [106, 121], v: [862, 900], great: [0.15, 0.21] },
  { name: 'planner+50ms', policy: 'planner', delay: 3, night: [180, 187], v: [1162, 1299], great: [0.34, 0.36] },
  { name: 'planner', policy: 'planner', delay: 0, night: 'survive', v: [2245, 2443], great: [0.9, 1] },
];

/** Relative distance from a range (0 inside). */
function dev(x: number, [lo, hi]: [number, number]): number {
  if (x < lo) return (lo - x) / Math.max(1e-9, Math.abs(lo));
  if (x > hi) return (x - hi) / Math.max(1e-9, Math.abs(hi));
  return 0;
}

const share = (r: { great: number; landings: number }): number => (r.landings ? r.great / r.landings : 0);
const pct = (x: number): string => `${(x * 100).toFixed(1)}%`;
const rng = (r: [number, number], f: (x: number) => string = String): string =>
  r[0] === r[1] ? `~${f(r[0])}` : `${f(r[0])}–${f(r[1])}`;

// Architecture guard: src/sim and src/world stay free of three.js and the DOM.
function guard(): string[] {
  const bad: string[] = [];
  for (const dir of ['src/sim', 'src/world']) {
    for (const f of readdirSync(dir)) {
      const src = readFileSync(join(dir, f), 'utf8');
      if (/from\s+['"]three['"]|\b(window|document|localStorage|requestAnimationFrame)\b/.test(src)) bad.push(`${dir}/${f}`);
    }
  }
  return bad;
}

type RefModule = {
  runBot: (policy: string, seed: number, T: number, delay: number) => Omit<BotResult, 'caught'>;
};

async function main(): Promise<void> {
  applyPreset('classic');
  const useRef = process.argv.includes('--ref');
  const ref = useRef
    ? ((await import(pathToFileURL(resolve('reference/physics-sim.mjs')).href)) as RefModule)
    : null;

  const t0 = performance.now();
  const lines: string[] = [];
  const head = ['bot', 'seed', 'night s', 'v p50', 'GREAT', 'spec night', 'spec v', 'spec GREAT', 'ref night', 'ref v', 'ref GREAT', 'Δspec', 'Δref', ''];
  const rows: string[][] = [];
  let fails = 0;

  for (const s of SPECS) {
    for (const seed of SEEDS) {
      const r = runBot(s.policy, seed, T, s.delay);
      const g = share(r);
      // deviation vs SPEC
      let dSpec = 0;
      if (s.night === 'survive') dSpec = Math.max(dSpec, r.caught === null ? 0 : 1);
      else dSpec = Math.max(dSpec, r.caught === null ? 1 : dev(r.caught, s.night));
      dSpec = Math.max(dSpec, dev(r.v_p50, s.v));
      if (s.great) dSpec = Math.max(dSpec, dev(g, s.great));
      // deviation vs the reference implementation (same seed/bot)
      let dRef = 0;
      let refCells = ['-', '-', '-'];
      if (ref) {
        const q = ref.runBot(s.policy, seed, T, s.delay);
        const qn = typeof q.nightCatches_s === 'number' ? q.nightCatches_s : T + 1;
        const rn = r.caught === null ? T + 1 : Math.round(r.caught);
        const qg = share(q);
        dRef = Math.max(
          Math.abs(rn - qn) / qn,
          Math.abs(r.v_p50 - q.v_p50) / Math.max(1, q.v_p50),
          Math.abs(g - qg) / Math.max(0.05, qg),
        );
        refCells = [String(q.nightCatches_s), String(q.v_p50), s.great ? pct(qg) : '—'];
      }
      const ok = dSpec <= TOL; // the v1 reference (dRef) is informational only
      if (!ok) fails++;
      rows.push([
        s.name,
        String(seed),
        String(r.nightCatches_s),
        String(r.v_p50),
        s.great ? pct(g) : '—',
        s.night === 'survive' ? `>${T}` : rng(s.night),
        rng(s.v),
        s.great ? (s.great[0] === 0 ? `<${pct(s.great[1])}` : s.great[1] === 1 ? `≥${pct(s.great[0])}` : rng(s.great, pct)) : '—',
        ...refCells,
        pct(dSpec),
        ref ? pct(dRef) : '-',
        ok ? 'PASS' : 'FAIL',
      ]);
    }
  }

  const w = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  const fmt = (r: string[]): string => r.map((c, i) => c.padEnd(w[i])).join('  ');
  lines.push(fmt(head), w.map((n) => '-'.repeat(n)).join('  '));
  let prev = '';
  for (const r of rows) {
    if (prev && r[0] !== prev) lines.push('');
    prev = r[0];
    lines.push(fmt(r));
  }
  console.log(`\nSunset Dash — physics v2 regression (preset classic, terrain=reference, ${T} s, seeds ${SEEDS.join('/')}, tol ${TOL * 100}%)\n`);
  console.log(lines.join('\n'));

  const g = guard();
  if (g.length) {
    fails++;
    console.log(`\nARCH GUARD FAIL: three.js/DOM referenced in ${g.join(', ')}`);
  }
  console.log(`\n${fails === 0 ? 'ACCEPTANCE: PASS' : `ACCEPTANCE: FAIL (${fails})`}  —  ${((performance.now() - t0) / 1000).toFixed(1)} s`);
  process.exitCode = fails === 0 ? 0 : 1;
}

void main();
