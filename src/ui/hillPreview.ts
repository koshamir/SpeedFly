import { CONFIG } from '../config';
import { islandStyle, type Island } from '../world/islands';
import { segMaxSlope, type Terrain } from '../world/terrain';
import { World } from '../world/world';

// Tune panel, Hills tab: the terrain the current CONFIG.hills/islands generate for a seed.
// A throwaway World is built on every request (UI code: it may allocate). Rows: hills 1-7 of islands
// 1-4 (= styles 0-3, the selected style is highlighted) and the end of island 1 (summit -> descent ->
// ramp -> lip -> sea -> landing slope) with the scripted jump parabola. One common scale, NO vertical
// exaggeration (1 px up = 1 px across); rows only differ in height.

const ROW_HILLS = 7;
const MAX_SCALE_H = 64; // css px for the hills rows' relief: on a wide screen the scale is limited by it
const GAP = 4;
const READ_SPEED = 1500; // px/s for the island length readout

interface Row {
  label: string;
  x0: number;
  x1: number;
  yLo: number;
  yHi: number;
  style: number; // -1 = the island end row
  h?: number;
  top?: number;
}

interface Arc {
  x: number; // launch (bird center)
  y: number;
  th: number; // rad
  k: number; // y = y + tan(th)(X - x) - k (X - x)^2
  tx: number; // target x
  t: number; // flight time (s)
  apex: number; // px above the launch point
  label: string;
}

export class HillPreview {
  private queued = false;
  private dirty = true;
  visible = false;
  /** Style highlighted in the strips (the style editor's selection). */
  style = 0;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly stats: HTMLElement,
    private readonly seed: () => number,
  ) {}

  /** Redraw on the next frame (many slider input events collapse into one draw). */
  request(): void {
    this.dirty = true;
    if (this.queued || !this.visible) return;
    this.queued = true;
    requestAnimationFrame(() => {
      this.queued = false;
      if (this.visible && this.dirty) this.draw();
    });
  }

  show(on: boolean): void {
    this.visible = on;
    if (on && this.dirty) this.request();
  }

  private draw(): void {
    const t0 = performance.now();
    this.dirty = false;
    const world = new World(this.seed(), 'islands');
    const T = world.terrain, L = world.islands;
    for (let guard = 0; guard < 6000 && (L.length < 5 || !Number.isFinite(L[3].lipX)); guard++) T.ensure(T.lastX + 1);
    if (L.length < 4) return;
    const kx = T.kx, ky = T.ky, b = T.base;
    const loc = (g: number): number => g - b;
    const cur = T.cursor();
    const R = CONFIG.physics.birdRadius, H = CONFIG.hills, I = CONFIG.islands;

    const rows: Row[] = [];
    for (let k = 1; k <= 4; k++) {
      const isl = L[k - 1];
      const i0 = loc(isl.hillK0) - 1, i1 = Math.min(i0 + 2 * ROW_HILLS, loc(isl.hillK1) - 1);
      let yLo = Infinity, yHi = -Infinity;
      for (let i = i0; i <= i1; i++) {
        yLo = Math.min(yLo, ky[i]);
        yHi = Math.max(yHi, ky[i]);
      }
      rows.push({ label: `о.${k} · ${islandStyle(k).name}`, x0: kx[i0], x1: kx[i1], yLo: yLo - 6, yHi: yHi + 2 * R + 6, style: isl.style });
    }
    // island 1 end: last peak -> landing slope, with the jump arcs
    const e = L[0];
    const ie0 = loc(e.hillK1) - 1;
    const arcs = [arc(cur, e, e.lipX, I.vLaunchMin, 'vMin, с края'), arc(cur, e, e.launchX0, I.vLaunchMax, 'vMax, с рампы')];
    const xEnd = e.targetX + I.landW * 0.6;
    let yLo = I.waterY, yHi = -Infinity;
    for (let i = ie0; i < T.n && kx[i] <= xEnd; i++) yHi = Math.max(yHi, ky[i]);
    for (const a of arcs) yHi = Math.max(yHi, a.y + a.apex);
    rows.push({ label: 'о.1 · конец + прыжок', x0: kx[ie0], x1: xEnd, yLo: yLo - 30, yHi: yHi + 40, style: -1 });

    // one scale: widest row across, the tallest hills row's relief vertically (the end row grows taller)
    const cssW = this.canvas.clientWidth || 360;
    let span = 1, relief = 1;
    for (const r of rows) {
      span = Math.max(span, r.x1 - r.x0);
      if (r.style >= 0) relief = Math.max(relief, r.yHi - r.yLo);
    }
    const scale = Math.min(cssW / span, MAX_SCALE_H / relief);
    let y = 0;
    for (const r of rows) {
      r.top = y;
      r.h = Math.ceil((r.yHi - r.yLo) * scale) + 2;
      y += r.h + GAP;
    }
    const cssH = y - GAP;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cw = Math.round(cssW * dpr), ch = Math.round(cssH * dpr);
    if (this.canvas.width !== cw || this.canvas.height !== ch) {
      this.canvas.width = cw;
      this.canvas.height = ch;
    }
    this.canvas.style.height = `${cssH}px`;
    const g = this.canvas.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, cssW, cssH);
    g.font = '600 10px Fredoka, system-ui, sans-serif';

    const step = Math.max(8, 1 / scale); // world px per sample: 8 px or one css pixel (phone budget < 4 ms)
    for (const r of rows) {
      const top = r.top!, rh = r.h!, x0 = r.x0, x1 = r.x1;
      const sx = (x: number): number => (x - x0) * scale;
      const sy = (yy: number): number => top + 1 + (r.yHi - yy) * scale;
      const sel = r.style === this.style;
      g.save();
      g.beginPath();
      g.rect(0, top, cssW, rh);
      g.clip();
      g.fillStyle = sel ? 'rgba(255,210,63,0.12)' : 'rgba(255,255,255,0.05)';
      g.fillRect(0, top, cssW, rh);
      if (r.style < 0) {
        // the sea
        g.fillStyle = 'rgba(63,169,224,0.55)';
        g.fillRect(sx(e.wx0), sy(e.surfaceY), sx(e.wx1) - sx(e.wx0), rh);
      }
      // ground
      g.beginPath();
      g.moveTo(0, top + rh);
      for (let x = x0; ; x += step) {
        const xx = Math.min(x, x1);
        g.lineTo(sx(xx), sy(cur.height(xx)));
        if (xx >= x1) break;
      }
      g.lineTo(sx(x1), top + rh);
      g.closePath();
      g.fillStyle = sel ? 'rgba(255,190,90,0.7)' : 'rgba(255,170,90,0.5)';
      g.fill();
      g.strokeStyle = '#ffd9a0';
      g.lineWidth = 1.25;
      g.stroke();
      // guide: peak level (peaks) / clamp levels (zigzag)
      g.setLineDash([4, 3]);
      g.strokeStyle = 'rgba(160,230,255,0.75)';
      g.lineWidth = 1;
      for (const yy of H.mode === 1 && r.style >= 0 ? [H.zzMinY, H.zzMaxY] : [H.peakY]) {
        g.beginPath();
        g.moveTo(0, sy(yy));
        g.lineTo(cssW, sy(yy));
        g.stroke();
      }
      g.setLineDash([]);
      if (r.style >= 0) {
        // key points: peaks yellow, valleys cyan
        for (let i = 0; i < T.n; i++) {
          if (kx[i] < x0 - 1) continue;
          if (kx[i] > x1 + 1) break;
          g.fillStyle = ky[i] >= H.peakY - H.peakJitter - 1 ? '#ffd23f' : '#3fd5ff';
          g.beginPath();
          g.arc(sx(kx[i]), sy(ky[i]), 1.8, 0, Math.PI * 2);
          g.fill();
        }
      } else {
        // the jump: exact parabolas (the shape is speed-independent; speed only changes the time)
        arcs.forEach((a, n) => {
          g.setLineDash(n ? [5, 3] : [2, 3]);
          g.strokeStyle = n ? '#ff8fb1' : '#ffffff';
          g.lineWidth = 1.4;
          g.beginPath();
          for (let X = a.x; ; X += step) {
            const xx = Math.min(X, a.tx), d = xx - a.x;
            const yy = a.y + Math.tan(a.th) * d - a.k * d * d;
            if (X === a.x) g.moveTo(sx(xx), sy(yy));
            else g.lineTo(sx(xx), sy(yy));
            if (xx >= a.tx) break;
          }
          g.stroke();
        });
        g.setLineDash([]);
        g.fillStyle = '#5cff7a';
        g.beginPath();
        g.arc(sx(e.targetX), sy(e.targetY + R), 3, 0, Math.PI * 2);
        g.fill();
      }
      // the bird for scale on the row's first point
      g.strokeStyle = '#ffffff';
      g.lineWidth = 1;
      g.beginPath();
      g.arc(sx(x0), sy(cur.height(x0) + R), Math.max(1.5, R * scale), 0, Math.PI * 2);
      g.stroke();
      g.fillStyle = 'rgba(255,255,255,0.85)';
      g.fillText(r.label, cssW - g.measureText(r.label).width - 4, top + 11);
      g.restore();
    }

    const lines: string[] = [];
    for (let k = 1; k <= 4; k++) lines.push(islandLine(T, L, k, loc));
    lines.push(arcs.map((a) => `${a.label}: ${a.t.toFixed(1)} с, апекс +${a.apex.toFixed(0)}`).join(' · '));
    const ms = performance.now() - t0;
    lines.push(`пунктир: ${H.mode === 1 ? 'zzMinY/zzMaxY' : 'peakY'} · ○ птица · ● цель посадки · ${ms.toFixed(1)} ms`);
    this.stats.textContent = lines.join('\n');
  }
}

/** The scripted jump from launch contact x at speed sp — the same numbers as Run.checkLaunch. */
function arc(cur: ReturnType<Terrain['cursor']>, isl: Island, ux: number, sp: number, label: string): Arc {
  const I = CONFIG.islands, R = CONFIG.physics.birdRadius;
  cur.sample(ux);
  const Ln = Math.hypot(1, cur.d1);
  const x = ux - (R * cur.d1) / Ln, y = cur.y + R / Ln;
  const th = Math.max(I.launchAngle, (Math.atan(cur.d1) * 180) / Math.PI + I.launchClear) * (Math.PI / 180);
  const s = Math.min(I.vLaunchMax, Math.max(I.vLaunchMin, sp));
  const vx = s * Math.cos(th), vy = s * Math.sin(th);
  const D = Math.max(300, isl.targetX - x), dy = isl.targetY + R - y;
  const gg = Math.max(150, (2 * vx * vx * (D * Math.tan(th) - dy)) / (D * D));
  return { x, y, th, k: gg / (2 * vx * vx), tx: x + D, t: D / vx, apex: (vy * vy) / (2 * gg), label };
}

/** Island k: hills, steepest slope, length (first hill -> lip) in seconds at READ_SPEED. */
function islandLine(T: Terrain, L: Island[], k: number, loc: (g: number) => number): string {
  const isl = L[k - 1];
  const i0 = loc(isl.hillK0) - 1, i1 = loc(isl.hillK1) - 1;
  let slope = 0;
  for (let i = Math.max(0, i0); i < i1 && i < T.n - 1; i++) slope = Math.max(slope, segMaxSlope(T.kx[i + 1] - T.kx[i], T.ky[i + 1] - T.ky[i], T.kq[i]));
  const hills = (i1 - i0) / 2;
  const len = Number.isFinite(isl.lipX) ? (isl.lipX - T.kx[Math.max(0, i0)]) / READ_SPEED : NaN;
  return `о.${k} ${islandStyle(k).name}: ${hills} холмов · круче ${((Math.atan(slope) * 180) / Math.PI).toFixed(0)}° · ${Number.isFinite(len) ? len.toFixed(0) : '?'} с при ${READ_SPEED} px/s`;
}
