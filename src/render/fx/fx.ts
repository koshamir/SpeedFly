import * as THREE from 'three';
import { CONFIG } from '../../config';
import type { GameBus, GameEvents } from '../../core/events';
import type { Run } from '../../sim/run';
import { hexRgb, type RGB } from '../palette';
import { Frame, Particles, PF } from './particles';

const rnd = (a: number, b: number): number => a + Math.random() * (b - a);

// Event-driven FX (§7.6). Bound only to takeoff / land / feverStart / skyTouch / coin / speedTier
// (never to micro-hops: those don't reach the bus). Handlers only copy numbers out of the payloads.
export class Fx {
  readonly group = new THREE.Group();
  readonly particles = new Particles();
  private run!: Run;
  private readonly cWater: RGB = hexRgb(CONFIG.colors.water);
  private readonly cFoam: RGB = hexRgb(CONFIG.colors.foam);

  constructor(bus: GameBus) {
    this.particles.mesh.renderOrder = 7;
    this.group.add(this.particles.mesh);
    bus.on('land', (e) => this.onLand(e));
  }

  reset(run: Run): void {
    this.run = run;
    this.particles.clear();
  }

  private onLand(e: GameEvents['land']): void {
    if (e.kind === 'splash') this.splash(e.gx, e.gy, this.run.bird.vx, e.speed);
  }

  private splash(x: number, y: number, vx: number, speed: number): void {
    const p = this.particles, F = CONFIG.fx;
    const k = Math.min(1.6, 0.6 + speed / 1500);
    for (let i = 0; i < F.splashDrops * k; i++) {
      const c = Math.random() < 0.5 ? this.cWater : this.cFoam;
      p.emit(Frame.Drop, x + rnd(-20, 20), y, vx * 0.2 + rnd(-260, 260), rnd(350, 950) * k, rnd(0.5, 0.9), rnd(16, 26), 8, c, 1, 0, 1900, 0.5, 0, 0, PF.Stretch, 0.6);
    }
    p.emit(Frame.Ring, x, y, 0, 0, 0.55, 30, 220 * k, this.cFoam, 0.9, 0, 0, 0, 0, 0, PF.Grow, 0.28);
    for (let i = 0; i < 4; i++) p.emit(Frame.Puff, x + rnd(-36, 36), y + 4, rnd(-90, 90), rnd(60, 180), rnd(0.3, 0.5), rnd(12, 18), rnd(30, 42), this.cFoam, 0.75, 0, 300, 3, 0, 0, PF.Grow);
  }

  update(dt: number, left: number, bottom: number, z: number): void {
    this.particles.update(dt, left, bottom, z);
  }
}
