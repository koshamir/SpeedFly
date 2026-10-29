import { CONFIG } from '../config';
import type { LandKind } from '../core/events';
import { World } from '../world/world';
import { Bird, EV_LAND, speedOf, step } from './bird';
import type { Terrain, TerrainCursor } from '../world/terrain';

// Bots from reference/physics-sim.mjs: autopilot (?bot=1) and acceptance runs (npm run sim).

export type BotPolicy = 'none' | 'always' | 'naive' | 'planner';

export class Bot {
  private readonly scratch = new Bird();
  private readonly cur: TerrainCursor;
  private readonly q: Uint8Array;
  private qHead = 0;
  private qLen = 0;
  private k = 0;
  private held = false;
  private pKind: LandKind = 'ok';
  private pAng = 0;
  private pV = 0;

  constructor(
    private readonly terrain: Terrain,
    readonly policy: BotPolicy,
    readonly delay = 0, // in decisions (x decideEvery steps)
  ) {
    this.cur = terrain.cursor();
    this.q = new Uint8Array(delay + 1);
  }

  /** Call once per fixed step, before stepping the bird. */
  tick(b: Bird): boolean {
    if (this.k % CONFIG.bot.decideEvery === 0) {
      const want = this.want(b);
      if (this.delay) {
        const cap = this.q.length;
        this.q[(this.qHead + this.qLen) % cap] = want ? 1 : 0;
        this.qLen++;
        if (this.qLen > this.delay) {
          this.held = this.q[this.qHead] === 1;
          this.qHead = (this.qHead + 1) % cap;
          this.qLen--;
        }
      } else this.held = want;
    }
    this.k++;
    return this.held;
  }

  private want(b: Bird): boolean {
    this.cur.sample(b.x);
    const d1 = this.cur.d1;
    switch (this.policy) {
      case 'none':
        return false;
      case 'always':
        return true;
      case 'naive':
        return b.grounded && d1 < CONFIG.bot.naiveSlope;
      case 'planner':
        return this.planner(b, d1);
    }
  }

  private planner(b: Bird, d1: number): boolean {
    const B = CONFIG.bot;
    if (b.grounded) return d1 < B.groundSlope; // ground: hold on downhill, release on uphill
    let best = 1e9, bestScore = -1e18;
    const plans = B.plans;
    for (let i = 0; i < plans.length; i++) {
      const r = plans[i];
      this.predict(b, r);
      const score = this.pKind === 'great' ? B.greatScore + this.pV : -this.pAng * B.angPenalty + this.pV * B.speedWeight;
      if (score > bestScore) {
        bestScore = score;
        best = r;
      }
    }
    return best === 0;
  }

  /** Release for N steps, then dive until touchdown. */
  private predict(b: Bird, releaseSteps: number): void {
    const c = this.scratch;
    c.copyFrom(b);
    let n = 0;
    let kind: LandKind = 'ok', ang = 0;
    const P = CONFIG.physics;
    while (!c.grounded && n < CONFIG.bot.maxPredict) {
      step(c, n >= releaseSteps, this.cur, this.terrain, P);
      if (c.ev === EV_LAND) {
        kind = c.evKind;
        ang = c.evAngle;
      }
      n++;
    }
    if (c.grounded) {
      this.pKind = kind;
      this.pAng = ang;
      this.pV = c.v;
    } else {
      this.pKind = 'bad';
      this.pAng = CONFIG.bot.failAngle;
      this.pV = 0;
    }
  }
}

export interface BotResult {
  policy: string;
  nightCatches_s: number | string;
  caught: number | null;
  dist: number;
  v_p50: number;
  v_p90: number;
  airShare: number;
  maxAlt: number;
  landings: number;
  great: number;
  bad: number;
  avgAngle: number;
  flight_p50: number;
}

/** Headless acceptance run on the reference terrain (port of runBot from the reference). */
export function runBot(policy: BotPolicy, seed = 7, T = 240, delay = 0): BotResult {
  const P = CONFIG.physics, Nt = CONFIG.night;
  const world = new World(seed, 'reference');
  const terrain = world.terrain;
  const cur = terrain.cursor();
  const b = new Bird();
  b.reset(cur, CONFIG.terrain.refStartX, P.startSpeed);
  const bot = new Bot(terrain, policy, delay);
  const speeds = new Float64Array(Math.ceil(T / P.dt / CONFIG.bot.sampleEvery) + 2);
  const flights: number[] = [];
  let ns = 0, t = 0, k = 0;
  let caught: number | null = null;
  while (t < T) {
    const held = bot.tick(b);
    step(b, held, cur, terrain, P);
    if (b.ev === EV_LAND) flights.push(b.evFlight);
    t += P.dt;
    k++;
    if (k % CONFIG.bot.sampleEvery === 0) speeds[ns++] = speedOf(b);
    if (k % CONFIG.terrain.updateEvery === 0) world.update(b.x); // exercise streaming + trimming
    const xn = -Nt.startGap + Nt.v0 * t + 0.5 * Nt.accel * t * t;
    if (caught === null && xn >= b.x) caught = t;
  }
  const sp = speeds.subarray(0, ns).sort();
  const p = (f: number): number => Math.round(sp[Math.floor(f * (sp.length - 1))]);
  const fl = flights.sort((a, z) => a - z);
  return {
    policy,
    nightCatches_s: caught === null ? `>${T}` : Math.round(caught),
    caught,
    dist: Math.round(b.x),
    v_p50: p(0.5),
    v_p90: p(0.9),
    airShare: +(b.airTime / T).toFixed(2),
    maxAlt: Math.round(b.maxAlt),
    landings: b.landings,
    great: b.great,
    bad: b.bad,
    avgAngle: +(b.angSum / Math.max(1, b.landings)).toFixed(1),
    flight_p50: Math.round(fl[fl.length >> 1] || 0),
  };
}
