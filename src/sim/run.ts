import { CONFIG } from '../config';
import type { GameBus, GameEvents } from '../core/events';
import { COIN_BLUE } from '../world/collectibles';
import { World, type TerrainMode } from '../world/world';
import type { TerrainCursor } from '../world/terrain';
import { Bird, EV_LAND, EV_TAKEOFF, speedOf, step } from './bird';
import { Night } from './night';
import { Scoring } from './scoring';

// One run of the game (deterministic, no three.js / DOM). main.ts owns the state machine.
export class Run {
  readonly world: World;
  readonly bird = new Bird();
  readonly cur: TerrainCursor;
  readonly night = new Night();
  readonly score = new Scoring();
  started = false;
  over = false;
  t = 0;
  steps = 0;
  held = false;
  speed = 0;
  tier = 0;
  fever = false;
  island = 1;
  skyTouched = false; // this flight
  // sprite center (contact + normal * R), current and previous step (render interpolation)
  cx = 0;
  cy = 0;
  pcx = 0;
  pcy = 0;
  private feverT0 = 0;
  private islandIdx = 0;
  private coinPtr = 0;
  private lastArc = -1;
  private chain = 0;
  // debug
  lastKind = '';
  lastAngle = 0;

  // reused event payloads (handlers copy what they keep)
  private readonly eTakeoff: GameEvents['takeoff'] = { x: 0, y: 0, speed: 0 };
  private readonly eLand: GameEvents['land'] = { kind: 'ok', angle: 0, airTime: 0, streak: 0, x: 0, y: 0, speed: 0 };
  private readonly eFeverStart: GameEvents['feverStart'] = { streak: 0 };
  private readonly eFeverEnd: GameEvents['feverEnd'] = { duration: 0 };
  private readonly eSky: GameEvents['skyTouch'] = { x: 0, y: 0 };
  private readonly eCoin: GameEvents['coin'] = { type: 'gold', x: 0, y: 0, chain: 0 };
  private readonly eIsland: GameEvents['island'] = { index: 0 };
  private readonly eTier: GameEvents['speedTier'] = { tier: 0, prev: 0 };
  private readonly eCaught: GameEvents['caught'] = { x: 0 };
  private readonly ePoints: GameEvents['points'] = { amount: 0, x: 0, y: 0 };

  constructor(
    readonly seed: number,
    mode: TerrainMode,
    private readonly bus: GameBus,
  ) {
    this.world = new World(seed, mode);
    this.cur = this.world.terrain.cursor();
    const startX = mode === 'reference' ? CONFIG.terrain.refStartX : 0;
    const P = CONFIG.physics;
    this.bird.reset(this.cur, startX, P.startSpeed, P.birdRadius, P.gRelease);
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
    const x0 = b.x;
    step(b, held, this.cur, this.world.terrain, P);
    this.t += P.dt;
    this.steps++;
    if (b.ev === EV_TAKEOFF) this.onTakeoff();
    this.updateCenter();
    if (b.ev === EV_LAND) this.onLand();

    // distance points (x2 in Fever)
    this.score.distPx += b.x - x0;
    this.score.add((b.x - x0) / CONFIG.score.distPerPt, this.fever);
    if (this.fever) this.score.feverTime += P.dt;

    if (!b.grounded && !this.skyTouched && this.cy > CONFIG.sky.cloudY) this.onSkyTouch();
    this.pickCoins();
    this.checkIsland();
    this.updateSpeed();
    if (this.steps % CONFIG.terrain.updateEvery === 0) this.world.update(b.x);

    this.night.t = this.t;
    if (this.night.x >= b.x) {
      this.over = true;
      if (this.fever) this.endFever();
      this.eCaught.x = b.x;
      this.bus.emit('caught', this.eCaught);
    }
  }

  private points(amount: number): void {
    const p = this.score.add(amount, this.fever);
    if (p < 1) return;
    const e = this.ePoints;
    e.amount = Math.round(p);
    e.x = this.cx;
    e.y = this.cy;
    this.bus.emit('points', e);
  }

  private onTakeoff(): void {
    const b = this.bird;
    this.skyTouched = false;
    const e = this.eTakeoff;
    e.x = b.x;
    e.y = b.y;
    e.speed = b.v;
    this.bus.emit('takeoff', e);
  }

  private onLand(): void {
    const b = this.bird, S = CONFIG.score, sc = this.score;
    const kind = b.evKind;
    this.lastKind = kind;
    this.lastAngle = b.evAngle;
    sc.landings++;
    if (kind === 'great') sc.greats++;
    else if (kind === 'bad') sc.bads++;
    else if (kind === 'splash') sc.splashes++;
    // streak / Fever (Fever never touches physics)
    if (kind === 'great') {
      if (!this.fever && b.streak >= S.feverStreak) {
        this.fever = true;
        this.feverT0 = this.t;
        this.eFeverStart.streak = b.streak;
        this.bus.emit('feverStart', this.eFeverStart);
      }
    } else if (this.fever) this.endFever();

    const e = this.eLand;
    e.kind = kind;
    e.angle = b.evAngle;
    e.airTime = b.evAirTime;
    e.streak = b.streak;
    e.x = this.cx;
    e.y = this.cy;
    e.speed = b.v;
    this.bus.emit('land', e);
    this.points(Scoring.landing(kind === 'great', b.evAirTime, b.streak));
  }

  private endFever(): void {
    this.fever = false;
    this.eFeverEnd.duration = this.t - this.feverT0;
    this.bus.emit('feverEnd', this.eFeverEnd);
  }

  private onSkyTouch(): void {
    this.skyTouched = true;
    this.score.skyTouches++;
    this.eSky.x = this.cx;
    this.eSky.y = this.cy;
    this.bus.emit('skyTouch', this.eSky);
    this.points(CONFIG.score.skyTouch);
  }

  private pickCoins(): void {
    const c = this.world.coins, K = CONFIG.coins;
    const rad = K.pickupRadius, r2 = rad * rad;
    let i = this.coinPtr - c.base;
    if (i < 0) i = 0;
    while (i < c.n && c.x[i] < this.cx - rad) i++;
    this.coinPtr = i + c.base;
    for (let j = i; j < c.n && c.x[j] <= this.cx + rad; j++) {
      if (!c.alive[j]) continue;
      const dx = c.x[j] - this.cx, dy = c.y[j] - this.cy;
      if (dx * dx + dy * dy > r2) continue;
      c.alive[j] = 0;
      const blue = c.type[j] === COIN_BLUE;
      if (blue) {
        // speed x1.12 (at least +120)
        const b = this.bird, sp = speedOf(b);
        const f = Math.max(K.blueMul, (sp + K.blueMinAdd) / sp);
        if (b.grounded) b.v *= f;
        else {
          b.vx *= f;
          b.vy *= f;
        }
        this.score.blueCoins++;
      } else this.score.coins++;
      this.chain = c.arc[j] === this.lastArc ? this.chain + 1 : 1;
      this.lastArc = c.arc[j];
      const e = this.eCoin;
      e.type = blue ? 'blue' : 'gold';
      e.x = c.x[j];
      e.y = c.y[j];
      e.chain = this.chain;
      this.bus.emit('coin', e);
      this.score.add(blue ? CONFIG.score.blueCoin : CONFIG.score.coin, this.fever);
    }
  }

  private checkIsland(): void {
    const L = this.world.islands;
    while (this.islandIdx < L.length && L[this.islandIdx].landingX <= this.bird.x) {
      const k = L[this.islandIdx].k;
      this.islandIdx++;
      this.island = k + 1;
      this.score.islands++;
      this.night.push += CONFIG.night.islandPushback;
      this.eIsland.index = k + 1;
      this.bus.emit('island', this.eIsland);
      this.points(CONFIG.score.islandPer * k);
    }
  }

  private updateSpeed(): void {
    const sp = speedOf(this.bird), V = CONFIG.speed;
    this.speed = sp;
    if (sp > this.score.maxSpeed) this.score.maxSpeed = sp;
    let tier = this.tier;
    while (tier < V.tiers.length && sp >= V.tiers[tier]) tier++;
    while (tier > 0 && sp < V.tiers[tier - 1] - V.tierHysteresis) tier--;
    if (tier !== this.tier) {
      this.eTier.prev = this.tier;
      this.eTier.tier = tier;
      this.tier = tier;
      this.bus.emit('speedTier', this.eTier);
    }
  }

  /** Sprite center = the physics state (circle center): continuous through takeoffs and landings. */
  private updateCenter(): void {
    this.cx = this.bird.x;
    this.cy = this.bird.y;
  }
}
