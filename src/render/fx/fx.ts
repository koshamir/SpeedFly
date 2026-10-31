import * as THREE from 'three';
import { CONFIG } from '../../config';
import type { GameBus, GameEvents } from '../../core/events';
import type { Run } from '../../sim/run';
import type { TerrainCursor } from '../../world/terrain';
import { hexRgb, type RGB } from '../palette';
import { Frame, Particles, PF } from './particles';
import { Trail } from './trail';

const rnd = (a: number, b: number): number => a + Math.random() * (b - a);

// Event-driven FX (§7.6). Bound only to takeoff / land / feverStart / skyTouch / coin / speedTier /
// islandLaunch / islandLand (never to micro-hops: those don't reach the bus). Handlers copy numbers out
// of the payloads. Continuous FX (speed lines, trail, island-jump wind) follow the run state each frame.
export class Fx {
  readonly group = new THREE.Group();
  readonly particles = new Particles();
  readonly trail = new Trail();
  /** First SONIC per flight (3 s cooldown): ring here; the renderer adds shake, audio the boom. */
  onSonic: (() => void) | null = null;
  private run!: Run;
  private time = 0;
  private lineAcc = 0;
  private sonicArmed = true;
  private lastSonic = -1e9;
  private readonly grade: RGB = [1, 1, 1];
  private readonly tmp: RGB = [0, 0, 0];
  private readonly c: Record<string, RGB> = {};
  private cur: TerrainCursor | null = null;
  // island jump: clouds that drift in front of the bird near the apex
  private cloudX = Infinity;
  private apexY = 0;
  private flyAcc = 0;

  constructor(bus: GameBus) {
    this.particles.mesh.renderOrder = 7;
    this.group.add(this.trail.mesh, this.particles.mesh);
    const C = CONFIG.colors;
    for (const [k, hex] of Object.entries({
      water: C.water,
      foam: C.foam,
      white: '#FFFFFF',
      gold: C.gold,
      blue: C.blue,
      feather: '#C9B8F2',
      star: '#FFE14D',
      spark: '#FFF3B0',
    }))
      this.c[k] = hexRgb(hex);
    bus.on('land', (e) => this.onLand(e));
    bus.on('takeoff', (e) => this.onTakeoff(e));
    bus.on('skyTouch', (e) => this.skyPuff(e.x, e.y));
    bus.on('coin', (e) => this.coinGlint(e.type === 'blue', e.x, e.y));
    bus.on('feverStart', () => this.feverBurst());
    bus.on('speedTier', (e) => this.onTier(e.tier, e.prev));
    bus.on('islandLaunch', (e) => this.onLaunch(e));
    bus.on('islandLand', (e) => this.onIslandLand(e));
  }

  reset(run: Run): void {
    this.run = run;
    this.particles.clear();
    this.trail.reset();
    this.sonicArmed = true;
    this.lastSonic = -1e9;
    this.cur = run.world.terrain.cursor();
    this.cloudX = Infinity;
  }

  /** Island jump take-off: a burst + dust thrown off the lip; clouds get scheduled near the apex. */
  private onLaunch(e: GameEvents['islandLaunch']): void {
    const p = this.particles, F = CONFIG.fx;
    const gy = this.cur ? this.cur.height(e.x) : e.y - CONFIG.physics.birdRadius;
    const col = this.rim(e.x);
    for (let i = 0; i < F.launchDust; i++)
      p.emit(Frame.Puff, e.x + rnd(-30, 20), gy + 6, rnd(-420, -60), rnd(60, 260), rnd(0.5, 0.9), rnd(18, 30), rnd(60, 110), col, 0.9, 0, 160, 2.5, 0, 0, PF.Grow);
    for (let i = 0; i < F.launchSparks; i++) {
      const a = rnd(0, Math.PI * 2), v = rnd(260, 700);
      p.emit(Frame.Sparkle, e.x, e.y, Math.cos(a) * v, Math.sin(a) * v, rnd(0.5, 0.9), rnd(30, 50), 4, i % 3 ? this.c.spark : this.c.white, 1, 0.9, 200, 3, rnd(0, 3), rnd(-6, 6));
    }
    p.emit(Frame.Ring, e.x, e.y, 0, 0, 0.6, 40, 520, this.c.white, 0.9, 1, 0, 0, 0, 0, PF.Grow, 1);
    p.emit(Frame.Ring, e.x, e.y, 0, 0, 0.45, 30, 300, this.c.spark, 0.8, 1, 0, 0, 0, 0, PF.Grow, 1);
    this.cloudX = e.apexX - F.flightCloudAt * (e.apexX - e.x);
    this.apexY = e.apexY;
  }

  /** Island touchdown: a big sparkle impact + dust in the new island's rim colour. */
  private onIslandLand(e: GameEvents['islandLand']): void {
    const p = this.particles, F = CONFIG.fx;
    const gy = this.cur ? this.cur.height(e.x) : e.y - CONFIG.physics.birdRadius;
    this.cloudX = Infinity;
    for (let i = 0; i < F.landSparks; i++) {
      const a = rnd(0, Math.PI), v = rnd(250, 820);
      p.emit(Frame.Sparkle, e.x, e.y, Math.cos(a) * v, Math.sin(a) * v + 160, rnd(0.6, 1.1), rnd(30, 56), 4, i % 2 ? this.c.gold : this.c.spark, 1, 0.9, 420, 2.5, rnd(0, 3), rnd(-6, 6));
    }
    const col = this.rim(e.x);
    for (let i = 0; i < 8; i++)
      p.emit(Frame.Puff, e.x + rnd(-24, 24), gy + 6, rnd(-160, 420), rnd(40, 200), rnd(0.45, 0.8), rnd(20, 30), rnd(70, 110), col, 0.85, 0, 180, 3, 0, 0, PF.Grow);
    p.emit(Frame.Ring, e.x, e.y, 0, 0, 0.55, 40, 460, this.c.gold, 0.9, 1, 0, 0, 0, 0, PF.Grow, 0.5);
    p.emit(Frame.Ring, e.x, e.y, 0, 0, 0.4, 30, 260, this.c.white, 0.9, 1, 0, 0, 0, 0, PF.Grow, 0.5);
  }

  /** Big soft clouds around the apex height, ahead of the bird: it flies through / behind them. */
  private apexClouds(bx: number): void {
    const p = this.particles, col = this.lit(this.c.white, 0.6);
    // soft radial blobs in loose clusters (the Puff frame's hard disc reads as soap bubbles when huge)
    for (let i = 0; i < CONFIG.fx.flightClouds; i++) {
      const x = bx + rnd(200, 1700), y = this.apexY + rnd(-260, 140);
      for (let j = 0; j < 3; j++) {
        const s = rnd(420, 820);
        p.emit(Frame.Dot, x + rnd(-160, 160), y + rnd(-50, 50), rnd(-90, -30), 0, rnd(2.6, 3.4), s, s * 1.1, col, rnd(0.5, 0.75), 0, 0, 0, 0, 0, PF.FadeIn);
      }
    }
  }

  /** Colour graded by the time of day (into this.tmp). */
  private lit(c: RGB, k = 0.6): RGB {
    const t = this.tmp, g = this.grade;
    for (let i = 0; i < 3; i++) t[i] = c[i] * (1 + (g[i] - 1) * k);
    return t;
  }

  private rim(x: number): RGB {
    hexRgb(CONFIG.palettes[this.run.world.islandAt(x).palette].rim, this.tmp);
    return this.lit(this.tmp);
  }

  private onTakeoff(e: GameEvents['takeoff']): void {
    this.sonicArmed = true;
    const p = this.particles, col = this.rim(e.gx);
    const n = Math.min(6, 2 + e.speed / 500);
    for (let i = 0; i < n; i++) p.emit(Frame.Puff, e.gx + rnd(-10, 10), e.gy + 4, rnd(-120, 60) - e.speed * 0.1, rnd(40, 140), rnd(0.3, 0.5), rnd(10, 16), rnd(22, 32), col, 0.85, 0, 120, 3, 0, 0, PF.Grow);
  }

  private onLand(e: GameEvents['land']): void {
    this.sonicArmed = true;
    const p = this.particles, F = CONFIG.fx;
    if (e.kind === 'splash') return this.splash(e.gx, e.gy, this.run.bird.vx, e.speed);
    // landing dust in the island's rim colour, thrown forward along the slope
    const col = this.rim(e.gx);
    const n = (e.kind === 'bad' ? F.dustBad : F.dust) * Math.min(1.5, 0.6 + e.speed / 1500);
    for (let i = 0; i < n; i++) {
      const fwd = Math.random() < 0.7 ? 1 : -1;
      p.emit(Frame.Dot, e.gx + rnd(-12, 12), e.gy + 6, fwd * rnd(80, 320) + e.speed * 0.06, rnd(30, 150), rnd(0.35, 0.6), rnd(22, 32), rnd(56, 84), col, 0.6, 0, 120, 4, 0, 0, PF.Grow);
    }
    if (e.kind === 'great') {
      for (let i = 0; i < F.greatSparks; i++) {
        const a = rnd(0, Math.PI * 2), v = rnd(180, 520);
        p.emit(Frame.Sparkle, e.x, e.y, Math.cos(a) * v, Math.sin(a) * v + 120, rnd(0.45, 0.8), rnd(26, 42), 4, i % 3 ? this.c.spark : this.c.white, 1, 0.8, 260, 3.5, rnd(0, 3), rnd(-6, 6));
      }
      p.emit(Frame.Ring, e.x, e.y, 0, 0, 0.35, 30, 150, this.c.spark, 0.8, 1, 0, 0, 0, 0, PF.Grow);
    } else if (e.kind === 'bad') {
      for (let i = 0; i < F.badFeathers; i++)
        p.emit(Frame.Feather, e.x + rnd(-10, 10), e.y + rnd(-6, 10), rnd(-200, 200), rnd(150, 420), rnd(0.9, 1.4), rnd(22, 30), 18, this.lit(this.c.feather, 0.4), 1, 0, 520, 2.6, rnd(0, 6), rnd(-7, 7));
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2;
        p.emit(Frame.Star, e.x + Math.cos(a) * 26, e.y + 30 + Math.sin(a) * 10, -Math.sin(a) * 90, Math.cos(a) * 30 + 30, 0.8, 20, 14, this.c.star, 1, 0, 0, 0.5, 0, 5);
      }
    }
  }

  private splash(x: number, y: number, vx: number, speed: number): void {
    const p = this.particles, F = CONFIG.fx;
    const k = Math.min(1.6, 0.6 + speed / 1500);
    for (let i = 0; i < F.splashDrops * k; i++) {
      const c = Math.random() < 0.5 ? this.c.water : this.c.foam;
      p.emit(Frame.Drop, x + rnd(-20, 20), y, vx * 0.2 + rnd(-260, 260), rnd(350, 950) * k, rnd(0.5, 0.9), rnd(16, 26), 8, this.lit(c, 0.5), 1, 0, 1900, 0.5, 0, 0, PF.Stretch, 0.6);
    }
    p.emit(Frame.Ring, x, y, 0, 0, 0.55, 30, 220 * k, this.lit(this.c.foam, 0.5), 0.9, 0, 0, 0, 0, 0, PF.Grow, 0.28);
    for (let i = 0; i < 4; i++) p.emit(Frame.Puff, x + rnd(-36, 36), y + 4, rnd(-90, 90), rnd(60, 180), rnd(0.3, 0.5), rnd(12, 18), rnd(30, 42), this.lit(this.c.foam, 0.5), 0.75, 0, 300, 3, 0, 0, PF.Grow);
  }

  private skyPuff(x: number, y: number): void {
    const p = this.particles, col = this.lit(this.c.white, 0.5);
    for (let i = 0; i < CONFIG.fx.skyPuffs; i++) {
      const a = rnd(0, Math.PI * 2), v = rnd(80, 300);
      p.emit(Frame.Puff, x + Math.cos(a) * 20, y + Math.sin(a) * 20, Math.cos(a) * v, Math.sin(a) * v, rnd(0.5, 0.9), rnd(24, 40), rnd(60, 90), col, 0.95, 0, 0, 2.5, 0, 0, PF.Grow);
    }
    for (let i = 0; i < 6; i++) p.emit(Frame.Sparkle, x + rnd(-40, 40), y + rnd(-30, 30), rnd(-60, 60), rnd(-60, 60), rnd(0.4, 0.7), 30, 6, this.c.white, 1, 1);
  }

  private coinGlint(blue: boolean, x: number, y: number): void {
    const p = this.particles, col = blue ? this.c.blue : this.c.gold;
    const n = blue ? 10 : 5;
    for (let i = 0; i < n; i++) {
      const a = rnd(0, Math.PI * 2), v = rnd(80, blue ? 380 : 220);
      p.emit(Frame.Sparkle, x, y, Math.cos(a) * v, Math.sin(a) * v, rnd(0.3, 0.55), rnd(18, blue ? 34 : 26), 4, i % 2 ? col : this.c.white, 1, 0.9, 0, 3, rnd(0, 3), rnd(-5, 5));
    }
    p.emit(Frame.Ring, x, y, 0, 0, 0.25, 12, blue ? 120 : 44, col, blue ? 0.9 : 0.55, 1, 0, 0, 0, 0, PF.Grow);
  }

  private feverBurst(): void {
    const p = this.particles, b = this.run.bird;
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * Math.PI * 2, v = rnd(320, 520);
      const h = i / 18;
      this.tmp[0] = 0.6 + 0.4 * Math.cos(6.28 * h);
      this.tmp[1] = 0.6 + 0.4 * Math.cos(6.28 * (h - 0.33));
      this.tmp[2] = 0.6 + 0.4 * Math.cos(6.28 * (h - 0.67));
      p.emit(Frame.Sparkle, b.x, b.y, Math.cos(a) * v, Math.sin(a) * v, 0.6, 34, 6, this.tmp, 1, 1, 0, 2.5, 0, 6);
    }
    p.emit(Frame.Ring, b.x, b.y, 0, 0, 0.45, 40, 260, this.c.star, 0.9, 1, 0, 0, 0, 0, PF.Grow);
  }

  private onTier(tier: number, prev: number): void {
    const F = CONFIG.fx;
    if (tier >= 4 && prev < 4 && this.sonicArmed && this.time - this.lastSonic >= F.sonicCooldown) {
      this.sonicArmed = false;
      this.lastSonic = this.time;
      const p = this.particles, b = this.run.bird;
      p.emit(Frame.Ring, b.x, b.y, 0, 0, 0.55, 40, F.sonicRing, this.c.white, 1, 1, 0, 0, 0, 0, PF.Grow, 1);
      p.emit(Frame.Ring, b.x, b.y, 0, 0, 0.4, 30, F.sonicRing * 0.6, this.c.white, 0.8, 1, 0, 0, 0, 0, PF.Grow, 0.55);
      this.onSonic?.();
    }
  }

  /** cine: 0..1 share of the island-jump flight shot on screen. */
  update(dt: number, bx: number, by: number, scale: number, left: number, bottom: number, z: number, logW: number, logH: number, grade: RGB, playing: boolean, cine = 0): void {
    const F = CONFIG.fx, run = this.run;
    this.time += dt;
    this.grade[0] = grade[0];
    this.grade[1] = grade[1];
    this.grade[2] = grade[2];
    // screen-space speed lines from FAST, density grows with the tier
    const tier = playing ? run.tier : 0;
    if (tier >= 2) {
      this.lineAcc += dt * F.lineRate[tier - 2];
      const a = F.lineAlpha * (0.7 + 0.3 * (tier - 2));
      while (this.lineAcc >= 1) {
        this.lineAcc -= 1;
        const v = rnd(2200, 3400) * (1 + 0.15 * (tier - 2));
        this.particles.emit(Frame.Streak, logW + rnd(0, 120), rnd(0.14, 0.86) * logH, -v, 0, rnd(0.25, 0.4), rnd(150, 300), 90, this.c.white, a, 0.4, 0, 0, Math.PI, 0, PF.Screen | PF.FadeIn, 0.09);
      }
    } else this.lineAcc = 0;
    // island jump: wind streaks along the flight direction, clouds at the apex, a long ribbon
    const flying = playing && run.flightK > 0;
    if (flying) {
      const b = run.bird, sp = Math.hypot(b.vx, b.vy) || 1;
      const dx = -b.vx / sp, dy = -b.vy / sp, rot = Math.atan2(dy, dx);
      this.flyAcc += dt * F.flightLineRate * cine;
      while (this.flyAcc >= 1) {
        this.flyAcc -= 1;
        const v = rnd(2400, 3600), sx = rnd(-0.1, 1.1) * logW, sy = rnd(0.1, 0.95) * logH;
        this.particles.emit(Frame.Streak, sx - dx * 300, sy - dy * 300, dx * v, dy * v, rnd(0.25, 0.45), rnd(180, 340), 90, this.c.white, 0.55, 0.5, 0, 0, rot, 0, PF.Screen | PF.FadeIn, 0.08);
      }
      if (bx >= this.cloudX) {
        this.cloudX = Infinity;
        this.apexClouds(bx);
      }
    } else this.flyAcc = 0;
    this.trail.update(dt, bx, by, playing && (tier >= 3 || run.fever || flying), run.fever, scale, this.time, flying);
    this.particles.update(dt, left, bottom, z);
  }
}
