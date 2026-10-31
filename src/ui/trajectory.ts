import { CONFIG } from '../config';
import { Bird, EV_HOP, EV_LAND, step } from '../sim/bird';
import type { Run } from '../sim/run';
import type { TerrainCursor } from '../world/terrain';

// Tune mode: while the bird is airborne, two dotted predicted paths until touchdown — "if you keep
// releasing" and "if you hold now" — coloured by the landing kind they would get. A scratch Bird is
// stepped with the real step() (same physics, same terrain), recomputed every 3rd frame within ~2 ms.

const COL: Record<string, string> = { great: '#5cff7a', ok: '#ffd23f', bad: '#ff5a4f', splash: '#3fd5ff', skim: '#d8d0f5', '': '#ffffff' };
const NAME: Record<string, string> = { great: 'GREAT', ok: 'GOOD', bad: 'BAD', splash: 'SPLASH', skim: 'skim', '': '…' };
const MAXP = 256;
const MAX_STEPS = 1200; // 5 s of flight
const BUDGET_MS = 2;

class Path {
  readonly x = new Float32Array(MAXP);
  readonly y = new Float32Array(MAXP);
  n = 0;
  kind = '';
  angle = 0;
  push(x: number, y: number): void {
    if (this.n < MAXP) {
      this.x[this.n] = x;
      this.y[this.n] = y;
      this.n++;
    }
  }
}

export class TrajPreview {
  on = true;
  /** ms of the last prediction (readout). */
  ms = 0;
  private readonly cv: HTMLCanvasElement;
  private readonly g: CanvasRenderingContext2D;
  private readonly b = new Bird();
  private readonly paths = [new Path(), new Path()];
  private readonly pt = { x: 0, y: 0 };
  private run: Run | null = null;
  private cur: TerrainCursor | null = null;
  private frameN = 0;
  private drawn = false;

  constructor(
    parent: HTMLElement,
    private readonly toScreen: (x: number, y: number, out: { x: number; y: number }) => void,
  ) {
    this.cv = document.createElement('canvas');
    this.cv.className = 'tune-traj';
    parent.prepend(this.cv); // under the HUD / panel
    this.g = this.cv.getContext('2d')!;
  }

  frame(run: Run): void {
    const b = run.bird;
    if (!this.on || b.grounded || !run.started || run.over) {
      if (this.drawn) this.clear();
      this.frameN = 0;
      return;
    }
    if (this.frameN++ % 3 === 0) this.predict(run);
    this.draw();
  }

  private clear(): void {
    this.g.setTransform(1, 0, 0, 1, 0, 0);
    this.g.clearRect(0, 0, this.cv.width, this.cv.height);
    this.drawn = false;
  }

  private predict(run: Run): void {
    if (this.run !== run) {
      this.run = run;
      this.cur = run.world.terrain.cursor();
    }
    const t0 = performance.now(), T = run.world.terrain, P = CONFIG.physics, cur = this.cur!;
    for (let k = 0; k < 2; k++) {
      const p = this.paths[k], b = this.b;
      b.copyFrom(run.bird);
      p.n = 0;
      p.kind = '';
      p.push(b.x, b.y);
      for (let i = 0; i < MAX_STEPS; i++) {
        step(b, k === 1, cur, T, P);
        if ((i & 3) === 3) p.push(b.x, b.y);
        if (b.ev === EV_LAND) {
          p.kind = b.evKind;
          p.angle = b.evAngle;
          break;
        }
        if (b.ev === EV_HOP || b.grounded) {
          p.kind = 'skim';
          break;
        }
        if ((i & 31) === 31 && performance.now() - t0 > BUDGET_MS) break;
      }
      p.push(b.x, b.y);
    }
    this.ms = performance.now() - t0;
  }

  private draw(): void {
    const cv = this.cv, g = this.g, dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = cv.clientWidth, h = cv.clientHeight;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
    }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    g.lineCap = 'round';
    g.font = '600 13px Fredoka, system-ui, sans-serif';
    const s = this.pt;
    for (let k = 0; k < 2; k++) {
      const p = this.paths[k];
      if (p.n < 2) continue;
      const col = COL[p.kind] ?? '#fff';
      g.setLineDash(k === 0 ? [2, 7] : [9, 6]);
      g.lineWidth = 3;
      g.strokeStyle = 'rgba(36,27,58,0.55)';
      g.beginPath();
      for (let i = 0; i < p.n; i++) {
        this.toScreen(p.x[i], p.y[i], s);
        if (i) g.lineTo(s.x, s.y);
        else g.moveTo(s.x, s.y);
      }
      g.stroke();
      g.lineWidth = 2;
      g.strokeStyle = col;
      g.stroke();
      g.setLineDash([]);
      // end marker + label
      this.toScreen(p.x[p.n - 1], p.y[p.n - 1], s);
      g.fillStyle = col;
      g.beginPath();
      g.arc(s.x, s.y, 5, 0, Math.PI * 2);
      g.fill();
      const txt = `${k ? 'держать' : 'отпустить'}: ${NAME[p.kind] ?? p.kind}${p.kind && p.kind !== 'skim' && p.kind !== 'splash' ? ` ${p.angle.toFixed(0)}°` : ''}`;
      g.lineWidth = 4;
      g.strokeStyle = '#241B3A';
      g.strokeText(txt, s.x + 8, s.y - 8 - k * 16);
      g.fillText(txt, s.x + 8, s.y - 8 - k * 16);
    }
    this.drawn = true;
  }
}
