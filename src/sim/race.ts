import { CONFIG, type PhysicsConfig } from '../config';
import type { GameBus } from '../core/events';
import { TRACKS, type TrackDef } from '../world/tracks';
import type { TerrainCursor } from '../world/terrain';
import { Bird, EV_LAND, speedOf, step } from './bird';
import { Bot } from './bot';
import { Run } from './run';

// Race mode (SPEC §14): the player's Run + AI birds on the same designed track, same physics.
// AI = the planner bot with a personality (reaction delay); a subtle rubber band scales their drag
// with the gap to the player (never a teleport, never a forward push). Deterministic, no DOM.

export interface Rival {
  name: string;
  scarf: string;
  delay: number; // bot decisions of reaction delay (x 1/60 s)
}

export const RIVALS: Rival[] = [
  { name: 'Pip', scarf: '#3FD5FF', delay: 4 },
  { name: 'Zuzu', scarf: '#7CFF8A', delay: 5 },
  { name: 'Kiki', scarf: '#FF8FD0', delay: 6 },
  { name: 'Bo', scarf: '#FFB547', delay: 8 },
];

export interface Racer {
  name: string;
  scarf: string;
  bird: Bird;
  /** Interpolation: center now / previous step. */
  px: number;
  py: number;
  held: boolean;
  finish: number; // s (-1 = running)
  out: boolean; // caught by the sunset
  player: boolean;
  drafting: boolean;
}

interface Ai extends Racer {
  bot: Bot;
  cur: TerrainCursor;
  phys: PhysicsConfig;
  rings: Uint8Array;
}

export class RaceRun {
  readonly run: Run;
  readonly def: TrackDef;
  readonly finishX: number;
  readonly racers: Racer[] = [];
  readonly ais: Ai[] = [];
  readonly player: Racer;
  t = 0;
  done = false;
  /** Player place when finished / caught. */
  place = 0;
  private playerRings: Uint8Array;
  private readonly draftPhys: PhysicsConfig;
  private doneT = -1;

  constructor(
    readonly track: number,
    bus: GameBus,
    rivals = RIVALS,
  ) {
    this.run = new Run(track, 'race', bus);
    this.def = TRACKS[track];
    const T = this.run.world.track!;
    this.finishX = T.finishX;
    this.draftPhys = { ...CONFIG.physics };
    this.playerRings = new Uint8Array(T.ringX.length);
    this.player = {
      name: 'You', scarf: '#E8414A', bird: this.run.bird, px: this.run.cx, py: this.run.cy, held: false,
      finish: -1, out: false, player: true, drafting: false,
    };
    this.racers.push(this.player);
    const P = CONFIG.physics;
    rivals.forEach((r, i) => {
      const cur = this.run.world.terrain.cursor();
      const bird = new Bird();
      bird.reset(cur, -70 * (i + 1), P.startSpeed, P.birdRadius, P.gRelease);
      const ai: Ai = {
        name: r.name, scarf: r.scarf, bird, px: bird.x, py: bird.y, held: false, finish: -1, out: false, player: false,
        drafting: false, bot: new Bot(this.run.world.terrain, 'planner', r.delay, CONFIG.race.aiPlanEvery), cur, phys: { ...P },
        rings: new Uint8Array(T.ringX.length),
      };
      this.ais.push(ai);
      this.racers.push(ai);
    });
  }

  start(): void {
    this.run.start();
  }

  private sunsetT = 0; // s since the last bird was put to sleep
  private front = -Infinity;

  /** Sunset front (sunset track only): trails the last running bird, closing in until it catches it. */
  get nightX(): number {
    return this.front;
  }

  private sunset(): void {
    const R = CONFIG.race;
    if (this.def.feature !== 'sunset') return;
    const running = this.racers.filter((r) => !r.out && r.finish < 0);
    if (running.length <= 1) {
      this.front = -Infinity;
      return;
    }
    let last = running[0];
    for (const r of running) if (r.bird.x < last.bird.x) last = r;
    this.sunsetT += CONFIG.physics.dt;
    const gap = R.sunsetGap * Math.max(0, 1 - this.sunsetT / R.sunsetClose);
    this.front = last.bird.x - gap;
    if (gap <= 0) {
      last.out = true;
      this.sunsetT = 0;
      if (last.player) {
        this.place = this.racers.length - this.racers.filter((o) => o.out && !o.player).length;
        this.doneT = this.t;
      }
    }
  }

  step(held: boolean): void {
    if (this.done) return;
    const R = CONFIG.race, P = CONFIG.physics, run = this.run;
    this.t += P.dt;
    const p = this.player;
    p.px = run.cx;
    p.py = run.cy;
    if (p.finish < 0 && !p.out) {
      // slipstream: the player drafts behind any rival
      p.drafting = this.def.feature === 'slip' && this.drafts(run.bird);
      if (p.drafting) {
        Object.assign(this.draftPhys, P);
        this.draftPhys.drag = P.drag * R.slipDrag;
        this.draftPhys.vSoft = P.vSoft + R.slipVSoft;
        run.phys = this.draftPhys;
      } else run.phys = P;
      p.held = held;
      run.step(held);
      this.rings(run.bird, this.playerRings);
    } else run.step(false); // after the finish the bird coasts (no input)
    // AI birds
    const gapRef = run.bird.x;
    for (const a of this.ais) {
      a.px = a.bird.x;
      a.py = a.bird.y;
      if (a.out) continue;
      // subtle rubber band on drag (player far ahead -> rivals a little slicker, and vice versa)
      const g = Math.max(-1, Math.min(1, (gapRef - a.bird.x) / R.catchUpPx));
      Object.assign(a.phys, P);
      a.phys.drag = P.drag * (1 - R.catchUp * g) * (a.drafting ? R.slipDrag : 1);
      if (a.drafting) a.phys.vSoft = P.vSoft + R.slipVSoft;
      a.drafting = false; // the slipstream is the player's tool (draft behind a rival)
      a.held = a.finish < 0 && a.bot.tick(a.bird);
      step(a.bird, a.held, a.cur, run.world.terrain, a.phys);
      if (a.bird.ev === EV_LAND && a.bird.evKind === 'bad') a.bird.streak = 0;
      this.rings(a.bird, a.rings);
      if (a.finish < 0 && a.bird.x >= this.finishX) a.finish = this.t;
    }
    if (p.finish < 0 && !p.out && run.bird.x >= this.finishX) {
      p.finish = this.t;
      this.place = 1 + this.ais.filter((a) => a.finish >= 0 && a.finish <= p.finish).length;
      this.doneT = this.t;
    }
    // sunset: the night closes in on the last bird
    this.sunset();
    run.raceNightX = this.front;
    const allIn = this.ais.every((a) => a.finish >= 0 || a.out);
    if (this.doneT >= 0 && (allIn || this.t - this.doneT >= R.afterFinish)) this.done = true;
    if (this.t > 600) this.done = true; // safety
  }

  /** Another bird a little ahead at about the same height. */
  private drafts(b: Bird): boolean {
    const R = CONFIG.race;
    for (const r of this.racers) {
      if (r.bird === b || r.out) continue;
      const dx = r.bird.x - b.x;
      if (dx > R.slipMin && dx < R.slipMax && Math.abs(r.bird.y - b.y) < R.slipDy) return true;
    }
    return false;
  }

  private rings(b: Bird, got: Uint8Array): void {
    const T = this.run.world.track!, R = CONFIG.race, r2 = R.ringRadius * R.ringRadius;
    for (let i = 0; i < T.ringX.length; i++) {
      if (got[i]) continue;
      const dx = T.ringX[i] - b.x;
      if (dx > R.ringRadius) break;
      const dy = T.ringY[i] - b.y;
      if (dx * dx + dy * dy > r2) continue;
      got[i] = 1;
      const sp = speedOf(b), f = Math.max(R.ringMul, (sp + R.ringAdd) / Math.max(1, sp));
      if (b.grounded) b.v *= f;
      else {
        b.vx *= f;
        b.vy *= f;
      }
      if (b === this.run.bird) this.ringHit = i;
    }
  }

  /** Index of a ring the player just went through (render / audio consume and reset it). */
  ringHit = -1;

  /** Live order: finished by time, then by distance. */
  order(): Racer[] {
    return [...this.racers].sort((a, b) => {
      if (a.out !== b.out) return a.out ? 1 : -1;
      if (a.finish >= 0 && b.finish >= 0) return a.finish - b.finish;
      if (a.finish >= 0) return -1;
      if (b.finish >= 0) return 1;
      return b.bird.x - a.bird.x;
    });
  }
}
