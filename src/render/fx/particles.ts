import * as THREE from 'three';
import { CONFIG } from '../../config';
import type { RGB } from '../palette';
import { SpriteBatch } from './sprites';

// Particle pool (§7.6): one instanced draw, fixed capacity, struct-of-arrays, no allocations after
// construction. Atlas frames are white shapes tinted per particle.

export const Frame = { Dot: 0, Sparkle: 1, Feather: 2, Ring: 3, Puff: 4, Star: 5, Streak: 6, Drop: 7 } as const;
export type Frame = (typeof Frame)[keyof typeof Frame];

/** Particle flags. */
export const PF = {
  Stretch: 1, // rotate along velocity, lengthen with speed
  Screen: 2, // x, y in logical screen px (origin bottom-left), not world
  FadeIn: 4,
  Grow: 8, // size eases out (rings, puffs) instead of linear
} as const;

const COLS = 4, ROWS = 2, CELL = 128;

function atlas(): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = COLS * CELL;
  cv.height = ROWS * CELL;
  const g = cv.getContext('2d')!;
  const out = CONFIG.colors.outline;
  const cell = (i: number, draw: (h: number) => void): void => {
    g.save();
    g.translate((i % COLS) * CELL + CELL / 2, Math.floor(i / COLS) * CELL + CELL / 2);
    draw(CELL / 2);
    g.restore();
  };
  cell(Frame.Dot, (h) => {
    const gr = g.createRadialGradient(0, 0, 0, 0, 0, h);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.35, 'rgba(255,255,255,0.8)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(-h, -h, 2 * h, 2 * h);
  });
  cell(Frame.Sparkle, (h) => {
    const gr = g.createRadialGradient(0, 0, 0, 0, 0, h * 0.6);
    gr.addColorStop(0, 'rgba(255,255,255,0.7)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(-h, -h, 2 * h, 2 * h);
    g.fillStyle = '#fff';
    g.beginPath();
    for (let k = 0; k < 8; k++) {
      const a = (k * Math.PI) / 4, r = k % 2 ? h * 0.16 : h * 0.95;
      g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    g.closePath();
    g.fill();
  });
  cell(Frame.Feather, (h) => {
    g.rotate(-0.5);
    g.beginPath();
    g.ellipse(0, 0, h * 0.82, h * 0.34, 0, 0, Math.PI * 2);
    g.fillStyle = '#fff';
    g.fill();
    g.lineWidth = h * 0.09;
    g.strokeStyle = out;
    g.stroke();
    g.beginPath();
    g.moveTo(-h * 0.95, 0);
    g.lineTo(h * 0.6, 0);
    g.lineWidth = h * 0.07;
    g.stroke();
  });
  cell(Frame.Ring, (h) => {
    g.beginPath();
    g.arc(0, 0, h * 0.82, 0, Math.PI * 2);
    g.lineWidth = h * 0.14;
    g.strokeStyle = '#fff';
    g.stroke();
    g.beginPath();
    g.arc(0, 0, h * 0.82, 0, Math.PI * 2);
    g.lineWidth = h * 0.3;
    g.strokeStyle = 'rgba(255,255,255,0.3)';
    g.stroke();
  });
  cell(Frame.Puff, (h) => {
    g.beginPath();
    g.arc(0, 0, h * 0.9, 0, Math.PI * 2);
    g.fillStyle = '#E4E4EC';
    g.fill();
    g.beginPath();
    g.arc(-h * 0.12, -h * 0.14, h * 0.7, 0, Math.PI * 2);
    g.fillStyle = '#fff';
    g.fill();
  });
  cell(Frame.Star, (h) => {
    g.beginPath();
    for (let k = 0; k < 10; k++) {
      const a = -Math.PI / 2 + (k * Math.PI) / 5, r = k % 2 ? h * 0.38 : h * 0.86;
      g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    g.closePath();
    g.fillStyle = '#fff';
    g.fill();
    g.lineJoin = 'round';
    g.lineWidth = h * 0.1;
    g.strokeStyle = out;
    g.stroke();
  });
  cell(Frame.Streak, (h) => {
    const gr = g.createLinearGradient(-h, 0, h, 0);
    gr.addColorStop(0, 'rgba(255,255,255,0)');
    gr.addColorStop(0.7, 'rgba(255,255,255,1)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.beginPath();
    g.ellipse(0, 0, h * 0.98, h * 0.12, 0, 0, Math.PI * 2);
    g.fill();
  });
  cell(Frame.Drop, (h) => {
    // teardrop pointing +x (stretched along velocity)
    g.beginPath();
    g.moveTo(h * 0.9, 0);
    g.quadraticCurveTo(h * 0.1, -h * 0.5, -h * 0.25, -h * 0.45);
    g.arc(-h * 0.3, 0, h * 0.45, -Math.PI / 2, Math.PI / 2, true);
    g.quadraticCurveTo(h * 0.1, h * 0.5, h * 0.9, 0);
    g.fillStyle = '#fff';
    g.fill();
  });
  const t = new THREE.CanvasTexture(cv);
  t.anisotropy = 2;
  return t;
}

export class Particles {
  readonly mesh: THREE.Mesh;
  readonly cap: number;
  /** Live budget (quality step-down), <= cap. */
  limit: number;
  n = 0;
  private readonly batch: SpriteBatch;
  // state
  private readonly x: Float32Array;
  private readonly y: Float32Array;
  private readonly vx: Float32Array;
  private readonly vy: Float32Array;
  private readonly age: Float32Array;
  private readonly life: Float32Array;
  private readonly s0: Float32Array;
  private readonly s1: Float32Array;
  private readonly rot: Float32Array;
  private readonly vr: Float32Array;
  private readonly grav: Float32Array;
  private readonly drag: Float32Array;
  private readonly rgba: Float32Array;
  private readonly frame: Float32Array;
  private readonly add: Float32Array;
  private readonly flags: Uint8Array;
  private readonly aspect: Float32Array; // height / width of the quad

  constructor(cap = CONFIG.fx.maxParticles) {
    this.cap = cap;
    this.limit = cap;
    const f = (k = 1): Float32Array => new Float32Array(cap * k);
    this.x = f();
    this.y = f();
    this.vx = f();
    this.vy = f();
    this.age = f();
    this.life = f();
    this.s0 = f();
    this.s1 = f();
    this.rot = f();
    this.vr = f();
    this.grav = f();
    this.drag = f();
    this.rgba = f(4);
    this.frame = f();
    this.add = f();
    this.flags = new Uint8Array(cap);
    this.aspect = f();
    this.batch = new SpriteBatch(cap, atlas(), COLS, ROWS);
    this.mesh = this.batch.mesh;
  }

  /** Spawn one particle; returns its index or -1 when the pool is full (oldest is never stolen). */
  emit(frame: Frame, x: number, y: number, vx: number, vy: number, life: number, s0: number, s1: number, col: RGB, alpha: number, add = 0, grav = 0, drag = 0, rot = 0, vr = 0, flags = 0, aspect = 1): number {
    if (this.n >= this.limit) return -1;
    const i = this.n++;
    this.frame[i] = frame;
    this.x[i] = x;
    this.y[i] = y;
    this.vx[i] = vx;
    this.vy[i] = vy;
    this.age[i] = 0;
    this.life[i] = life;
    this.s0[i] = s0;
    this.s1[i] = s1;
    this.rgba[i * 4] = col[0];
    this.rgba[i * 4 + 1] = col[1];
    this.rgba[i * 4 + 2] = col[2];
    this.rgba[i * 4 + 3] = alpha;
    this.add[i] = add;
    this.grav[i] = grav;
    this.drag[i] = drag;
    this.rot[i] = rot;
    this.vr[i] = vr;
    this.flags[i] = flags;
    this.aspect[i] = aspect;
    return i;
  }

  clear(): void {
    this.n = 0;
    this.batch.commit(0);
  }

  /** Advance and upload. (left, bottom) = world position of the view's bottom-left, z = zoom. */
  update(dt: number, left: number, bottom: number, z: number): void {
    let i = 0;
    while (i < this.n) {
      this.age[i] += dt;
      if (this.age[i] >= this.life[i]) {
        this.kill(i);
        continue;
      }
      const k = Math.exp(-this.drag[i] * dt);
      this.vx[i] *= k;
      this.vy[i] = this.vy[i] * k - this.grav[i] * dt;
      this.x[i] += this.vx[i] * dt;
      this.y[i] += this.vy[i] * dt;
      this.rot[i] += this.vr[i] * dt;
      i++;
    }
    for (let j = 0; j < this.n; j++) {
      const t = this.age[j] / this.life[j], fl = this.flags[j];
      const e = fl & PF.Grow ? 1 - (1 - t) * (1 - t) * (1 - t) : t;
      let size = this.s0[j] + (this.s1[j] - this.s0[j]) * e;
      let sx = size, rot = this.rot[j];
      if (fl & PF.Stretch) {
        const sp = Math.hypot(this.vx[j], this.vy[j]);
        rot = Math.atan2(this.vy[j], this.vx[j]);
        sx = size * (1 + sp * CONFIG.fx.stretchK);
      }
      let x = this.x[j], y = this.y[j];
      if (fl & PF.Screen) {
        x = left + x / z;
        y = bottom + y / z;
        sx /= z;
        size /= z;
      }
      let a = this.rgba[j * 4 + 3] * Math.min(1, (1 - t) / 0.4);
      if (fl & PF.FadeIn) a *= Math.min(1, t / 0.25);
      const c = j * 4;
      this.batch.set(j, x, y, rot, sx, size * this.aspect[j], this.rgba[c], this.rgba[c + 1], this.rgba[c + 2], a, this.frame[j], this.add[j]);
    }
    this.batch.commit(this.n);
  }

  /** Swap-remove (order inside the pool is not meaningful). */
  private kill(i: number): void {
    const l = --this.n;
    if (i === l) return;
    this.x[i] = this.x[l];
    this.y[i] = this.y[l];
    this.vx[i] = this.vx[l];
    this.vy[i] = this.vy[l];
    this.age[i] = this.age[l];
    this.life[i] = this.life[l];
    this.s0[i] = this.s0[l];
    this.s1[i] = this.s1[l];
    this.rot[i] = this.rot[l];
    this.vr[i] = this.vr[l];
    this.grav[i] = this.grav[l];
    this.drag[i] = this.drag[l];
    for (let c = 0; c < 4; c++) this.rgba[i * 4 + c] = this.rgba[l * 4 + c];
    this.frame[i] = this.frame[l];
    this.add[i] = this.add[l];
    this.flags[i] = this.flags[l];
    this.aspect[i] = this.aspect[l];
  }
}
