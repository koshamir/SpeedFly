import { CONFIG, type TrackDef } from '../config';
import { mulberry32 } from '../core/rng';
import { EventBus, type GameBus, type GameEvents } from '../core/events';
import { COIN_BLUE } from '../world/collectibles';
import { World } from '../world/world';
import { speedOf } from './bird';
import { Bot, type BotPolicy } from './bot';
import { Run } from './run';

// Race mode (SPEC §14): the player's Run + AI rivals (ghost Runs on the same World, same physics, planner
// bots with a personality). Deterministic: fixed track seed, seeded rival mistakes. No DOM / three.js.

export interface Racer {
  readonly name: string;
  readonly scarf: string;
  readonly run: Run;
  readonly bus: GameBus;
  readonly bot: Bot | null; // null = the human player (or the player's autopilot in main)
  readonly isPlayer: boolean;
  readonly baseMistake: number;
  readonly phys: typeof CONFIG.physics;
  /** Race time at the finish line (interpolated), null while racing. */
  finishT: number | null;
  /** Caught by the night (Sunset Chase). */
  out: boolean;
  drafting: boolean;
  band: number; // dynamic difficulty -1 (helped) .. +1 (held back)
  rings: Uint8Array; // rings taken by this rival (the player uses the world's coins)
}

export type RacePhase = 'countdown' | 'racing' | 'done';

export class Race {
  readonly world: World;
  readonly racers: Racer[] = [];
  readonly player: Racer;
  readonly finishX: number;
  readonly startX = 0;
  phase: RacePhase = 'countdown';
  countdown = CONFIG.race.countdown;
  /** Race time since GO. */
  t = 0;
  /** Seconds since the player finished / went out. */
  afterT = 0;
  /** Sunset Chase night front x (-Infinity when the track has no night). */
  nightX = -Infinity;
  /** Last finisher place announced (1-based), for main's popups. */
  readonly finished: Racer[] = [];
  onFinish: ((r: Racer, place: number) => void) | null = null;
  onOut: ((r: Racer) => void) | null = null;
  private readonly ringIdx: number[] = [];

  constructor(
    readonly trackIndex: number,
    playerBus: GameBus,
    playerBot: { policy: BotPolicy; delay: number } | null = null,
  ) {
    const R = CONFIG.race;
    const seed = 7001 + trackIndex * 101;
    this.world = new World(seed, 'islands', this.track);
    this.finishX = this.world.finishX;
    const c = this.world.coins;
    for (let i = 0; i < c.n; i++) if (c.type[i] === COIN_BLUE) this.ringIdx.push(i);
    const mk = (name: string, scarf: string, bus: GameBus, bot: Bot | null, isPlayer: boolean, mistake: number): Racer => {
      const run = new Run(seed, 'islands', bus, { world: this.world, ghost: !isPlayer, night: false });
      const phys = { ...CONFIG.physics };
      run.phys = phys;
      return { name, scarf, run, bus, bot, isPlayer, baseMistake: mistake, phys, finishT: null, out: false, drafting: false, band: 0, rings: new Uint8Array(this.ringIdx.length) };
    };
    const pb = playerBot ? new Bot(this.world.terrain, playerBot.policy, playerBot.delay) : null;
    this.player = mk('You', '#E8414A', playerBus, pb, true, 0);
    this.racers.push(this.player);
    const rng = mulberry32(seed ^ 0x51ed);
    for (const d of R.birds.slice(0, R.rivals)) {
      const bot = new Bot(this.world.terrain, 'planner', d.delay);
      bot.speedWeight = d.speedWeight;
      bot.mistake = d.mistake;
      bot.setRng(rng);
      this.racers.push(mk(d.name, d.scarf, new EventBus<GameEvents>(), bot, false, d.mistake));
    }
  }

  get track(): TrackDef {
    return CONFIG.race.tracks[this.trackIndex];
  }

  /** One fixed step. playerHeld = the human input (ignored when the player has an autopilot bot). */
  step(playerHeld: boolean): void {
    const R = CONFIG.race, dt = CONFIG.physics.dt;
    if (this.phase === 'countdown') {
      this.countdown -= dt;
      if (this.countdown <= 0) {
        this.phase = 'racing';
        for (const r of this.racers) r.run.start();
      }
      return;
    }
    this.t += dt;
    const night = this.track.feature === 'night';
    if (night) this.nightX = this.startX - R.nightGap + R.nightV0 * this.t + 0.5 * R.nightAccel * this.t * this.t;
    const px = this.player.run.bird.x, playerDone = this.player.finishT !== null || this.player.out;
    for (const r of this.racers) {
      if (r.out) continue;
      const b = r.run.bird;
      // per-bird physics: slipstream + dynamic difficulty only change air drag (never a push)
      Object.assign(r.phys, CONFIG.physics);
      let drag = 1, soft = 0;
      r.drafting = this.track.feature === 'draft' && r.finishT === null && this.drafting(r);
      if (r.drafting) {
        drag *= 1 - R.draftCut;
        soft += R.draftSoft;
      }
      if (!r.isPlayer) {
        const gap = b.x - px;
        const k = playerDone ? 0 : Math.max(-1, Math.min(1, (Math.abs(gap) - R.bandFar) / R.bandFar)) * Math.sign(gap);
        const target = Math.abs(gap) > R.bandFar ? k : 0;
        r.band += (target - r.band) * Math.min(1, dt / R.bandEase);
        drag *= 1 + R.bandDrag * r.band;
        soft -= R.bandSoft * r.band;
        r.bot!.mistake = r.baseMistake * (1 + R.bandMistake * r.band);
      }
      r.phys.drag *= drag;
      r.phys.vSoft += soft; // the soft speed limit (tw preset) is air drag too
      const held = r.bot ? r.bot.tick(b) : playerHeld;
      const x0 = b.x;
      r.run.step(held);
      if (!r.isPlayer) this.rings(r);
      if (r.finishT === null && b.x >= this.finishX) {
        r.finishT = this.t - (dt * (b.x - this.finishX)) / Math.max(1e-6, b.x - x0);
        this.finished.push(r);
        this.onFinish?.(r, this.finished.length);
      }
      if (night && r.finishT === null && b.x < this.nightX) {
        r.out = true;
        r.run.over = true;
        this.onOut?.(r);
      }
    }
    if (this.player.finishT !== null || this.player.out) this.afterT += dt;
    const allDone = this.racers.every((r) => r.finishT !== null || r.out);
    if (allDone || this.afterT >= R.finishWait || this.t > 900) this.phase = 'done';
  }

  /** Behind another bird, close enough: in its slipstream. */
  private drafting(r: Racer): boolean {
    const R = CONFIG.race, b = r.run.bird;
    for (const o of this.racers) {
      if (o === r || o.out) continue;
      const dx = o.run.bird.x - b.x, dy = o.run.bird.y - b.y;
      if (dx > 0 && dx < R.draftDx && Math.abs(dy) < R.draftDy) return true;
    }
    return false;
  }

  /** Boost rings for a rival (same boost as the player's blue coin). */
  private rings(r: Racer): void {
    const c = this.world.coins, b = r.run.bird, K = CONFIG.coins, rad = CONFIG.race.ringRadius;
    for (let i = 0; i < this.ringIdx.length; i++) {
      if (r.rings[i]) continue;
      const j = this.ringIdx[i], dx = c.x[j] - b.x, dy = c.y[j] - b.y;
      if (dx > rad) break; // sorted by x
      if (dx < -rad || dx * dx + dy * dy > rad * rad) continue;
      r.rings[i] = 1;
      const sp = speedOf(b), f = Math.max(K.blueMul, (sp + K.blueMinAdd) / Math.max(1, sp));
      if (b.grounded) b.v *= f;
      else {
        b.vx *= f;
        b.vy *= f;
      }
    }
  }

  /** Progress 0..1 of a racer (start -> finish). */
  progress(r: Racer): number {
    return Math.max(0, Math.min(1, (r.run.bird.x - this.startX) / (this.finishX - this.startX)));
  }

  /** Racers in standing order: finished by time, then racing by distance, then out (latest out first). */
  standings(): Racer[] {
    const rank = (r: Racer): number => (r.finishT !== null ? 2e9 - r.finishT * 1000 : r.out ? -1e9 + r.run.bird.x : r.run.bird.x);
    return [...this.racers].sort((a, b) => rank(b) - rank(a));
  }

  /** 1-based place of a racer now. */
  place(r: Racer): number {
    return this.standings().indexOf(r) + 1;
  }

  /** Final time: real, or estimated from the remaining distance at the current speed (not finished). */
  timeOf(r: Racer): { t: number; est: boolean } {
    if (r.finishT !== null) return { t: r.finishT, est: false };
    const rest = Math.max(0, this.finishX - r.run.bird.x);
    return { t: this.t + rest / Math.max(400, r.run.speed), est: true };
  }
}
