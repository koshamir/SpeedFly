import { CONFIG } from '../config';
import type { Terrain, TerrainGen } from './terrain';

// Race tracks (SPEC §14): hand-designed, identical every time. Built from our hill system as named
// sections, a block repeated up to the track length. Each track has one signature feature:
//   rings    — boost rings high in the sky over the slow sections (reward high flights)
//   slip     — slipstream: flying close behind another bird lowers your drag
//   sunset   — the night chases the pack and puts the last birds to sleep
// No randomness: the time depends on timing, landings and keeping speed/height only.

export type TrackFeature = 'rings' | 'slip' | 'sunset';

type Sec =
  | { t: 'hills'; n: number; w: number; h: number; q?: number } // rhythm: n hills (valley + peak at peakY)
  | { t: 'kick'; w: number; h: number; rise: number } // deep valley then a tall launch peak (peakY + rise)
  | { t: 'flat'; len: number; level: number; rings?: boolean } // slow shallow stretch at peakY - level
  | { t: 'drop'; len: number; drop: number }; // long descent below peak level and a climb back

export interface TrackDef {
  name: string;
  feature: TrackFeature;
  blurb: string;
  palette: number;
  block: Sec[];
  medals: [number, number, number]; // gold / silver / bronze times (s)
}

export const TRACKS: TrackDef[] = [
  {
    name: 'Meadow Rings',
    feature: 'rings',
    blurb: 'Fly high through the boost rings over the slow flats',
    palette: 0,
    block: [
      { t: 'hills', n: 5, w: 900, h: 210 },
      { t: 'kick', w: 1100, h: 330, rise: 240 },
      { t: 'flat', len: 2600, level: 160, rings: true },
      { t: 'hills', n: 3, w: 1000, h: 260 },
      { t: 'drop', len: 3200, drop: 700 },
    ],
    medals: [146, 162, 178],
  },
  {
    name: 'Candy Draft',
    feature: 'slip',
    blurb: 'Tuck in behind a rival to steal their slipstream',
    palette: 1,
    block: [
      { t: 'hills', n: 4, w: 820, h: 200 },
      { t: 'hills', n: 4, w: 900, h: 290, q: 1.25 }, // the fast line: big pumps that punish a late release
      { t: 'flat', len: 1500, level: 120 },
      { t: 'kick', w: 1200, h: 360, rise: 300 },
      { t: 'hills', n: 3, w: 1200, h: 230 },
    ],
    medals: [144, 160, 176],
  },
  {
    name: 'Ember Sunset',
    feature: 'sunset',
    blurb: 'The night chases the pack — the last bird falls asleep',
    palette: 3,
    block: [
      { t: 'hills', n: 6, w: 880, h: 230, q: 1.2 },
      { t: 'drop', len: 2800, drop: 600 },
      { t: 'kick', w: 1000, h: 300, rise: 260 },
      { t: 'flat', len: 2000, level: 180 },
      { t: 'hills', n: 3, w: 1100, h: 300 },
    ],
    medals: [142, 152, 165],
  },
];

export class TrackGen implements TerrainGen {
  /** x of the finish line. */
  readonly finishX: number;
  /** Boost rings (rings feature): centres. */
  readonly ringX: number[] = [];
  readonly ringY: number[] = [];
  private readonly pts: number[] = []; // x, y, q triples (built at construction)
  private i = 0;

  constructor(readonly def: TrackDef) {
    const R = CONFIG.race, P = CONFIG.hills.peakY;
    let x = 0, y: number = P;
    const push = (nx: number, ny: number, q = 1): void => {
      this.pts.push(nx, ny, q);
      x = nx;
      y = ny;
    };
    while (x < R.length) {
      for (const s of def.block) {
        if (s.t === 'hills')
          for (let k = 0; k < s.n; k++) {
            push(x + s.w / 2, Math.min(y, P) - s.h, s.q ?? 1);
            push(x + s.w / 2, P, s.q ?? 1);
          }
        else if (s.t === 'kick') {
          push(x + s.w / 2, Math.min(y, P) - s.h);
          push(x + s.w / 2, P + s.rise);
        } else if (s.t === 'flat') {
          const lv = P - s.level, n = Math.max(1, Math.round(s.len / 500));
          push(x + 500, lv - 30);
          for (let k = 0; k < n; k++) {
            if (s.rings && k % 2 === 0) {
              this.ringX.push(x + 250);
              this.ringY.push(P + R.ringHeight);
            }
            push(x + 250, lv);
            push(x + 250, lv - 30);
          }
          push(x + 700, P); // climb back to the peak level
        } else {
          push(x + s.len, y - s.drop);
          push(x + 900, P);
        }
      }
    }
    this.finishX = x;
    // after the finish: gentle run-out hills
    for (let k = 0; k < 40; k++) {
      push(x + 450, P - 120);
      push(x + 450, P);
    }
  }

  extend(t: Terrain): void {
    if (this.i >= this.pts.length) {
      t.push(t.lastX + 450, t.lastY < CONFIG.hills.peakY ? CONFIG.hills.peakY : CONFIG.hills.peakY - 120);
      return;
    }
    t.push(this.pts[this.i], this.pts[this.i + 1], this.pts[this.i + 2]);
    this.i += 3;
  }
}
