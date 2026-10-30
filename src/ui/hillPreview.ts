import { CONFIG } from '../config';
import { World } from '../world/world';

// Tune panel, Hills tab: the terrain profile the current CONFIG.hills/islands generate for a seed.
// A throwaway World is built on every request (UI code: it may allocate). Rows: island 1 hills 1-7,
// hills 8-14, island 4 hills 1-7 — one common scale, NO vertical exaggeration (1 px up = 1 px across).

const ROW_HILLS = 7;
const MAX_ROW_H = 64; // css px: on a wide screen the scale is limited by the height instead
const GAP = 4;

interface Row {
  label: string;
  k0: number; // first key index (a peak), local to the terrain arrays
  k1: number; // last key index (inclusive)
}

interface Stats {
  hills: number;
  width: number;
  dMin: number;
  dAvg: number;
  dMax: number;
  slope: number;
}

export class HillPreview {
  private queued = false;
  private dirty = true;
  visible = false;

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
    for (let guard = 0; guard < 4000 && (L.length < 4 || !Number.isFinite(L[3].hillK1)); guard++) T.ensure(T.lastX);
    if (L.length < 4) return;
    const kx = T.kx, ky = T.ky, b = T.base;
    const loc = (g: number): number => g - b;

    const i1 = loc(L[0].hillK0) - 1, i1e = loc(L[0].hillK1) - 1;
    const i4 = loc(L[3].hillK0) - 1, i4e = loc(L[3].hillK1) - 1;
    const rows: Row[] = [
      { label: 'о.1 · 1–7', k0: i1, k1: Math.min(i1 + 2 * ROW_HILLS, i1e) },
      { label: 'о.1 · 8–14', k0: Math.min(i1 + 2 * ROW_HILLS, i1e), k1: Math.min(i1 + 4 * ROW_HILLS, i1e) },
      { label: 'о.4 · 1–7', k0: i4, k1: Math.min(i4 + 2 * ROW_HILLS, i4e) },
    ];

    // one scale for all rows: width of the widest row, height of the tallest relief (+ the bird on a peak)
    const R = CONFIG.physics.birdRadius;
    let span = 1, yLo = Infinity, yHi = -Infinity;
    for (const r of rows) {
      span = Math.max(span, kx[r.k1] - kx[r.k0]);
      for (let i = r.k0; i <= r.k1; i++) {
        yLo = Math.min(yLo, ky[i]);
        yHi = Math.max(yHi, ky[i]);
      }
    }
    yHi += 2 * R + 6;
    yLo -= 6;
    const H = CONFIG.hills;
    if (H.mode === 1) {
      yLo = Math.min(yLo, H.zzMinY - 6);
      yHi = Math.max(yHi, H.zzMaxY + 2 * R);
    }
    const cssW = this.canvas.clientWidth || 360;
    const scale = Math.min(cssW / span, MAX_ROW_H / (yHi - yLo));
    const rowH = Math.ceil((yHi - yLo) * scale) + 2;
    const cssH = rows.length * rowH + (rows.length - 1) * GAP;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cw = Math.round(cssW * dpr), ch = Math.round(cssH * dpr);
    if (this.canvas.width !== cw || this.canvas.height !== ch) {
      this.canvas.width = cw;
      this.canvas.height = ch;
      this.canvas.style.height = `${cssH}px`;
    }
    const g = this.canvas.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, cssW, cssH);
    g.font = '600 10px Fredoka, system-ui, sans-serif';

    const cur = T.cursor();
    const step = Math.max(8, 1 / scale); // world px per sample: 8 px or one css pixel (phone budget < 4 ms)
    rows.forEach((r, n) => {
      const top = n * (rowH + GAP), x0 = kx[r.k0], x1 = kx[r.k1];
      const sx = (x: number): number => (x - x0) * scale;
      const sy = (y: number): number => top + 1 + (yHi - y) * scale;
      g.save();
      g.beginPath();
      g.rect(0, top, cssW, rowH);
      g.clip();
      g.fillStyle = 'rgba(255,255,255,0.05)';
      g.fillRect(0, top, cssW, rowH);
      // ground
      g.beginPath();
      g.moveTo(0, top + rowH);
      for (let x = x0; ; x += step) {
        const xx = Math.min(x, x1);
        g.lineTo(sx(xx), sy(cur.height(xx)));
        if (xx >= x1) break;
      }
      g.lineTo(sx(x1), top + rowH);
      g.closePath();
      g.fillStyle = 'rgba(255,170,90,0.55)';
      g.fill();
      g.strokeStyle = '#ffd9a0';
      g.lineWidth = 1.25;
      g.stroke();
      // guide levels: peak level (peaks) / clamp levels (zigzag)
      g.setLineDash([4, 3]);
      g.strokeStyle = 'rgba(160,230,255,0.75)';
      g.lineWidth = 1;
      const levels = H.mode === 1 ? [H.zzMinY, H.zzMaxY] : [H.peakY];
      for (const y of levels) {
        g.beginPath();
        g.moveTo(0, sy(y));
        g.lineTo(cssW, sy(y));
        g.stroke();
      }
      g.setLineDash([]);
      // key points: peaks yellow, valleys cyan
      for (let i = r.k0; i <= r.k1; i++) {
        const peak = (i - r.k0) % 2 === 0;
        g.fillStyle = peak ? '#ffd23f' : '#3fd5ff';
        g.beginPath();
        g.arc(sx(kx[i]), sy(ky[i]), 1.8, 0, Math.PI * 2);
        g.fill();
      }
      // the bird for scale: sitting on the row's first peak
      g.strokeStyle = '#ffffff';
      g.lineWidth = 1;
      g.beginPath();
      g.arc(sx(x0), sy(ky[r.k0] + R), Math.max(1.5, R * scale), 0, Math.PI * 2);
      g.stroke();
      g.fillStyle = 'rgba(255,255,255,0.8)';
      g.fillText(r.label, cssW - g.measureText(r.label).width - 4, top + 11);
      g.restore();
    });

    const s1 = stats(kx, ky, i1, i1e), s4 = stats(kx, ky, i4, i4e);
    const ms = performance.now() - t0;
    this.stats.textContent =
      `${line('о.1', s1)}\n${line('о.4', s4)}\n` +
      `пунктир: ${H.mode === 1 ? 'границы zzMinY/zzMaxY' : 'уровень вершин peakY'} · ○ птица · ${ms.toFixed(1)} ms`;
  }
}

/** Island hills from key k0 (the peak before the first valley) to k1 (the last peak). */
function stats(kx: Float64Array, ky: Float64Array, k0: number, k1: number): Stats {
  const hills = (k1 - k0) / 2;
  let dMin = Infinity, dMax = 0, dSum = 0, slope = 0;
  for (let v = k0 + 1; v < k1; v += 2) {
    const d = Math.min(ky[v - 1], ky[v + 1]) - ky[v];
    dMin = Math.min(dMin, d);
    dMax = Math.max(dMax, d);
    dSum += d;
  }
  for (let i = k0; i < k1; i++) {
    // max slope of a cosine segment = |dy| pi / (2 dx)
    slope = Math.max(slope, (Math.abs(ky[i + 1] - ky[i]) * Math.PI) / (2 * (kx[i + 1] - kx[i])));
  }
  return { hills, width: (kx[k1] - kx[k0]) / hills, dMin, dAvg: dSum / hills, dMax, slope: (Math.atan(slope) * 180) / Math.PI };
}

function line(name: string, s: Stats): string {
  return `${name}: ${s.hills} холмов · ширина ${s.width.toFixed(0)} · впадины ${s.dMin.toFixed(0)}/${s.dAvg.toFixed(0)}/${s.dMax.toFixed(0)} · круче ${s.slope.toFixed(0)}°`;
}
