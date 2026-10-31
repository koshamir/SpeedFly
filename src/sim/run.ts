import { CONFIG } from '../config';
import type { GameBus, GameEvents } from '../core/events';
import { COIN_BLUE } from '../world/collectibles';
import { World, type TerrainMode } from '../world/world';
import type { TerrainCursor } from '../world/terrain';
import { Bird, EV_LAND, EV_TAKEOFF, speedOf, step } from './bird';
import { Night } from './night';
import { Scoring, type ScoreCat } from './scoring';

// One run of the game (deterministic, no three.js / DOM). main.ts owns the state machine.
export class Run {
  readonly world: World;
  readonly bird = new Bird();
  readonly cur: TerrainCursor;
  readonly night: Night;
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
  // sprite center = bird circle center (bird.x, bird.y), current and previous step (render interpolation)
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
  lastSlope = 0; // deg, the ground under the last judged touchdown (- = downhill)
  // sky coins of the running island jump (along the exact parabola; separate from world.coins)
  readonly sky = { n: 0, x: new Float64Array(32), y: new Float64Array(32), alive: new Uint8Array(32), arc: 0 };

  // reused event payloads (handlers copy what they keep)
  private readonly eTakeoff: GameEvents['takeoff'] = { x: 0, y: 0, gx: 0, gy: 0, speed: 0 };
  private readonly eLand: GameEvents['land'] = { kind: 'ok', angle: 0, airTime: 0, streak: 0, x: 0, y: 0, gx: 0, gy: 0, speed: 0 };
  private readonly eFeverStart: GameEvents['feverStart'] = { streak: 0 };
  private readonly eFeverEnd: GameEvents['feverEnd'] = { duration: 0 };
  private readonly eSky: GameEvents['skyTouch'] = { x: 0, y: 0 };
  private readonly eCoin: GameEvents['coin'] = { type: 'gold', x: 0, y: 0, chain: 0 };
  private readonly eIsland: GameEvents['island'] = { index: 0 };
  private readonly eLaunch: GameEvents['islandLaunch'] = { k: 0, x: 0, y: 0, targetX: 0, targetY: 0, apexX: 0, apexY: 0, duration: 0, speed: 0 };
  private readonly eILand: GameEvents['islandLand'] = { k: 0, kind: 'ok', x: 0, y: 0, speed: 0 };
  /** Island of the running scripted flight (0 = none). */
  flightK = 0;
  private launchIdx = 0;
  private seqIdx = 0;
  /** s the night stood still (island-end sequences: summit -> landing are always safe). */
  nightPaused = 0;
  /** True from the mountain summit until the island landing target. */
  inSequence = false;
  private readonly eTier: GameEvents['speedTier'] = { tier: 0, prev: 0 };
  private readonly eCaught: GameEvents['caught'] = { x: 0 };
  private readonly ePoints: GameEvents['points'] = { amount: 0, x: 0, y: 0 };
  private readonly eDay: GameEvents['dayGain'] = { amount: 0, reason: 'great', x: 0, y: 0 };
  private readonly eNear: GameEvents['nightNear'] = { near: false };
  /** The night is within CONFIG.night.dangerAt (hysteresis dangerOff). */
  nightNear = false;

  /** Physics constants this bird steps with (race: a per-bird copy for slipstream / difficulty). */
  phys: typeof CONFIG.physics = CONFIG.physics;
  /** Race rival: shares the world, never picks the world's coins, never streams terrain. */
  readonly ghost: boolean;
  /** The endless-run night (off in races). */
  readonly nightOn: boolean;

  constructor(
    readonly seed: number,
    mode: TerrainMode,
    private readonly bus: GameBus,
    opts: { world?: World; ghost?: boolean; night?: boolean } = {},
  ) {
    this.world = opts.world ?? new World(seed, mode);
    this.ghost = opts.ghost ?? false;
    this.nightOn = opts.night ?? true;
    this.night = new Night(mode === 'reference');
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
    if (!this.nightOn) return 1;
    return this.night.daylight(this.bird.x);
  }

  step(held: boolean): void {
    if (!this.started || this.over) return;
    const b = this.bird, P = this.phys;
    this.held = held;
    this.pcx = this.cx;
    this.pcy = this.cy;
    const x0 = b.x;
    b.safe = this.inSequence;
    step(b, held, this.cur, this.world.terrain, P);
    this.t += P.dt;
    this.steps++;
    if (b.ev === EV_TAKEOFF) this.onTakeoff();
    this.checkLaunch();
    this.updateCenter();
    if (b.ev === EV_LAND) this.onLand();

    // distance points: faster tiers earn more per px (x2 in Fever)
    this.score.distPx += b.x - x0;
    this.score.add(((b.x - x0) / CONFIG.score.distPerPt) * (1 + CONFIG.score.tierBonus * this.tier), this.fever, 'dist');
    if (this.fever) {
      this.score.feverTime += P.dt;
      if (!this.night.legacy) this.night.push(CONFIG.night.feverPush * P.dt, b.x); // Fever holds the night back (no popup: the dial shows it)
    }

    if (!b.grounded && !this.skyTouched && this.cy > CONFIG.sky.cloudY) this.onSkyTouch();
    if (!this.ghost) this.pickCoins();
    this.checkIsland();
    this.updateSpeed();
    if (!this.ghost && this.steps % CONFIG.terrain.updateEvery === 0) this.world.update(b.x);

    // the island-end sequence (summit -> landing) is safe: the night waits
    const L = this.world.islands;
    while (this.seqIdx < L.length - 1 && L[this.seqIdx].targetX <= b.x) this.seqIdx++;
    const sq = L[this.seqIdx];
    this.inSequence = b.x >= sq.summitX - CONFIG.islands.safeBefore && b.x < sq.targetX;
    if (this.inSequence) this.nightPaused += P.dt;
    if (!this.nightOn) return;
    this.night.advance(this.inSequence ? 0 : P.dt, b.x, P.dt);
    const day = this.night.daylight(b.x), N = CONFIG.night;
    if (this.nightNear ? day > N.dangerOff : day < N.dangerAt) {
      this.nightNear = !this.nightNear;
      this.eNear.near = this.nightNear;
      this.bus.emit('nightNear', this.eNear);
    }
    if (this.night.x >= b.x) {
      this.over = true;
      if (this.fever) this.endFever();
      this.eCaught.x = b.x;
      this.bus.emit('caught', this.eCaught);
    }
  }

  /** Skill pushes the night back; a visible gain becomes a "+DAY" moment. */
  private pushNight(px: number, reason: GameEvents['dayGain']['reason']): void {
    if (!this.nightOn || (this.night.legacy && reason !== 'island')) return; // reference terrain: the historical rule
    const g = this.night.push(px, this.bird.x);
    if (g < CONFIG.night.popupMin) return;
    const e = this.eDay;
    e.amount = g;
    e.reason = reason;
    e.x = this.cx;
    e.y = this.cy;
    this.bus.emit('dayGain', e);
  }

  private points(amount: number, cat: ScoreCat): void {
    const p = this.score.add(amount, this.fever, cat);
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
    e.gx = b.u; // contact x under the center (bird.u), not bird.x
    e.gy = this.cur.height(b.u);
    e.speed = b.v;
    this.bus.emit('takeoff', e);
  }

  /** Arm the scripted island flight: a takeoff in [launchX0, wx0], or crossing the lip while airborne. */
  private checkLaunch(): void {
    const b = this.bird, L = this.world.islands;
    while (this.launchIdx < L.length && L[this.launchIdx].wx0 < b.x) this.launchIdx++;
    if (b.flyG > 0 || this.launchIdx >= L.length) return;
    const isl = L[this.launchIdx];
    if (b.x < isl.launchX0) return;
    if (b.grounded) {
      if (b.x < isl.lipX) return;
      b.grounded = false; // too slow to fly off the ramp: the lip throws the bird anyway
      b.airT = 0;
      b.airAlt = 0;
      b.fx = b.x;
    } else if (b.ev !== EV_TAKEOFF && b.x < isl.lipX) return;
    const I = CONFIG.islands;
    const D = Math.max(300, isl.targetX - b.x), dy = isl.targetY + CONFIG.physics.birdRadius - b.y;
    // arrive tangent to the landing slope: the parabola's end slope is 2 dy / D - tan(th) = slope there
    this.cur.sample(isl.targetX);
    const sT = this.cur.d1;
    const thMatch = (Math.atan((2 * dy) / D - sT) * 180) / Math.PI;
    this.cur.sample(b.u);
    // never aim into the ramp: at least launchClear degrees above the local slope
    const th = Math.max(I.launchAngle, thMatch, (Math.atan(this.cur.d1) * 180) / Math.PI + I.launchClear) * (Math.PI / 180);
    const sp = Math.min(I.vLaunchMax, Math.max(I.vLaunchMin, Math.hypot(b.vx, b.vy)));
    const vx = sp * Math.cos(th), vy = sp * Math.sin(th);
    // y(x) = tan(th) x - g x^2 / (2 vx^2) passes (D, dy)  ->  g = 2 vx^2 (D tan(th) - dy) / D^2
    const g = Math.max(150, (2 * vx * vx * (D * Math.tan(th) - dy)) / (D * D));
    b.vx = vx;
    b.vy = vy;
    b.flyG = g;
    this.flightK = isl.k;
    this.launchIdx++;
    const e = this.eLaunch, ta = vy / g;
    e.k = isl.k;
    e.x = b.x;
    e.y = b.y;
    e.targetX = isl.targetX;
    e.targetY = isl.targetY;
    e.apexX = b.x + vx * ta;
    e.apexY = b.y + (vy * vy) / (2 * g);
    e.duration = D / vx;
    e.speed = sp;
    this.skyCoins(b.x, b.y, vx, vy, g, D);
    this.bus.emit('islandLaunch', e);
  }

  /** A row of coins on the scripted parabola (the flight itself picks them up: a rising blip chain). */
  private skyCoins(x0: number, y0: number, vx: number, vy: number, g: number, D: number): void {
    const K = CONFIG.coins, s = this.sky, n = Math.min(K.skyCount, s.x.length);
    s.n = n;
    s.arc = -2 - this.launchIdx; // own chain id (world arcs are >= 0)
    for (let i = 0; i < n; i++) {
      const t = (D * (K.skyT0 + ((K.skyT1 - K.skyT0) * i) / Math.max(1, n - 1))) / vx;
      s.x[i] = x0 + vx * t;
      s.y[i] = y0 + vy * t - 0.5 * g * t * t;
      s.alive[i] = 1;
    }
  }

  private onLand(): void {
    const b = this.bird, S = CONFIG.score, sc = this.score;
    const kind = b.evKind;
    this.lastKind = kind;
    this.lastAngle = b.evAngle;
    sc.landings++;
    if (kind === 'great') {
      sc.greats++;
      if (b.streak > sc.bestStreak) sc.bestStreak = b.streak;
    }
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
    } else if (this.fever && (kind === 'bad' || kind === 'splash')) this.endFever(); // GOOD keeps Fever

    const e = this.eLand;
    e.kind = kind;
    e.angle = b.evAngle;
    e.airTime = b.evAirTime;
    e.streak = b.streak;
    e.x = this.cx;
    e.y = this.cy;
    e.gx = b.u; // touchdown contact (bird.u)
    e.gy = this.cur.height(b.u);
    this.lastSlope = (Math.atan(this.cur.d1) * 180) / Math.PI;
    e.speed = b.v;
    this.bus.emit('land', e);
    if (this.flightK > 0) {
      const f = this.eILand;
      f.k = this.flightK;
      f.kind = kind;
      f.x = this.cx;
      f.y = this.cy;
      f.speed = b.v;
      this.flightK = 0;
      this.sky.n = 0;
      this.bus.emit('islandLand', f);
      this.landPoints(kind === 'great', b.evAirTime, b.streak);
      this.points(CONFIG.score.islandLanding * f.k, 'island');
      if (kind === 'great') this.pushNight(CONFIG.night.perfectPush, 'perfect');
      return;
    }
    this.landPoints(kind === 'great', b.evAirTime, b.streak);
    if (kind === 'great') {
      const N = CONFIG.night;
      this.pushNight(Math.min(N.greatMax, N.greatPush + N.greatStep * (b.streak - 1)), 'great');
    }
  }

  private landPoints(great: boolean, air: number, streak: number): void {
    const S = CONFIG.score;
    if (air >= S.flightMin) this.points(S.flightPerSec * air, 'flight');
    if (great) this.points(Math.min(S.greatMax, S.greatBase + S.greatStep * (streak - 1)), 'great');
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
    this.points(CONFIG.score.skyTouch, 'sky');
    this.pushNight(CONFIG.night.skyPush, 'sky');
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
      this.score.add(blue ? CONFIG.score.blueCoin : CONFIG.score.coin, this.fever, 'coins');
    }
    const s = this.sky;
    for (let j = 0; j < s.n; j++) {
      if (!s.alive[j]) continue;
      const dx = s.x[j] - this.cx, dy = s.y[j] - this.cy;
      if (dx * dx + dy * dy > r2) continue;
      s.alive[j] = 0;
      this.score.coins++;
      this.chain = s.arc === this.lastArc ? this.chain + 1 : 1;
      this.lastArc = s.arc;
      const e = this.eCoin;
      e.type = 'gold';
      e.x = s.x[j];
      e.y = s.y[j];
      e.chain = this.chain;
      this.bus.emit('coin', e);
      this.score.add(CONFIG.score.coin, this.fever, 'coins');
    }
  }

  private checkIsland(): void {
    const L = this.world.islands;
    while (this.islandIdx < L.length && L[this.islandIdx].landingX <= this.bird.x) {
      const k = L[this.islandIdx].k;
      this.islandIdx++;
      this.island = k + 1;
      this.score.islands++;
      this.eIsland.index = k + 1;
      this.bus.emit('island', this.eIsland);
      this.points(CONFIG.score.islandPer * k, 'island');
      this.pushNight(this.night.legacy ? CONFIG.night.refIslandPush : CONFIG.night.islandPushback, 'island');
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
