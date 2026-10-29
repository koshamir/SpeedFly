import { CONFIG } from '../config';
import type { GameBus, GameEvents } from '../core/events';
import { World, type TerrainMode } from '../world/world';
import type { TerrainCursor } from '../world/terrain';
import { Bird, EV_LAND, EV_TAKEOFF, speedOf, step } from './bird';
import { Night } from './night';

// One run of the game (deterministic, no three.js / DOM). main.ts owns the state machine.
export class Run {
  readonly world: World;
  readonly bird = new Bird();
  readonly cur: TerrainCursor;
  readonly night = new Night();
  started = false;
  over = false;
  t = 0;
  steps = 0;
  held = false;
  speed = 0;
  // sprite center (contact + normal * R), current and previous step (render interpolation)
  cx = 0;
  cy = 0;
  pcx = 0;
  pcy = 0;
  private t0nx = 0;
  private t0ny = 1;
  // debug
  lastKind = '';
  lastAngle = 0;

  private readonly eTakeoff: GameEvents['takeoff'] = { x: 0, y: 0, speed: 0 };
  private readonly eLand: GameEvents['land'] = { kind: 'ok', angle: 0, airTime: 0, streak: 0, x: 0, y: 0, speed: 0 };
  private readonly eCaught: GameEvents['caught'] = { x: 0 };

  constructor(
    readonly seed: number,
    mode: TerrainMode,
    private readonly bus: GameBus,
  ) {
    this.world = new World(seed, mode);
    this.cur = this.world.terrain.cursor();
    const startX = mode === 'reference' ? CONFIG.terrain.refStartX : 0;
    this.bird.reset(this.cur, startX, CONFIG.physics.startSpeed);
    this.updateCenter();
    this.pcx = this.cx;
    this.pcy = this.cy;
  }

  /** First touch: the day starts. */
  start(): void {
    this.started = true;
  }

  get daylight(): number {
    return this.night.daylight(this.bird.x);
  }

  step(held: boolean): void {
    if (!this.started || this.over) return;
    const b = this.bird, P = CONFIG.physics;
    this.held = held;
    this.pcx = this.cx;
    this.pcy = this.cy;
    step(b, held, this.cur, this.world.terrain, P);
    this.t += P.dt;
    this.steps++;
    if (b.ev === EV_TAKEOFF) this.onTakeoff();
    else if (b.ev === EV_LAND) this.onLand();
    this.updateCenter();
    this.speed = speedOf(b);
    if (this.steps % CONFIG.terrain.updateEvery === 0) this.world.update(b.x);

    this.night.t = this.t;
    if (this.night.x >= b.x) {
      this.over = true;
      this.eCaught.x = b.x;
      this.bus.emit('caught', this.eCaught);
    }
  }

  private onTakeoff(): void {
    const b = this.bird;
    // takeoff normal: center offset blends from here to (0, R)
    const L = Math.hypot(1, this.cur.d1);
    this.t0nx = -this.cur.d1 / L;
    this.t0ny = 1 / L;
    const e = this.eTakeoff;
    e.x = b.x;
    e.y = b.y;
    e.speed = b.v;
    this.bus.emit('takeoff', e);
  }

  private onLand(): void {
    const b = this.bird;
    this.lastKind = b.evKind;
    this.lastAngle = b.evAngle;
    const e = this.eLand;
    e.kind = b.evKind;
    e.angle = b.evAngle;
    e.airTime = b.evAirTime;
    e.streak = b.streak;
    e.x = b.x;
    e.y = b.y;
    e.speed = b.v;
    this.bus.emit('land', e);
  }

  private updateCenter(): void {
    const b = this.bird, R = CONFIG.physics.birdRadius;
    let nx: number, ny: number;
    if (b.grounded) {
      // the cursor was last sampled at b.x by the physics step
      const d1 = this.cur.d1, L = Math.hypot(1, d1);
      nx = -d1 / L;
      ny = 1 / L;
    } else {
      const f = Math.min(1, b.airT / CONFIG.physics.airBlend);
      nx = this.t0nx * (1 - f);
      ny = this.t0ny + (1 - this.t0ny) * f;
      const l = Math.hypot(nx, ny);
      nx /= l;
      ny /= l;
    }
    this.cx = b.x + nx * R;
    this.cy = b.y + ny * R;
  }
}
