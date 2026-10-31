import { CONFIG } from '../config';

// The night chases the bird along x. Rule for the player: "speed and skill buy daylight".
//  - The night front moves at vNight(t) = v0 + grow·(1 − e^(−t/tau)) + creep·t (t = night time, which stands
//    still during island-end sequences). Flying faster than the night opens the gap, slower closes it.
//  - Skill pushes the front back (GREAT, Fever, sky touch, islands): push(). The gap is capped at maxGap,
//    so daylight can't be banked forever and the slowly rising vNight eventually wins.
//  - daylight = clamp(gap / daylightGap) drives the sky, the HUD dial and the warnings.
// 'reference' terrain keeps the historical closed form (npm run sim acceptance table).
export class Night {
  t = 0;
  x: number;
  /** Smoothed d(daylight)/dt (1/s): > 0 the night retreats, < 0 it approaches. */
  rate = 0;
  private prevGap = NaN;
  private legacyPush = 0;

  constructor(readonly legacy = false) {
    this.x = -(legacy ? CONFIG.night.refStartGap : CONFIG.night.startGap);
  }

  /** Night speed now (px/s). */
  get speed(): number {
    const N = CONFIG.night;
    if (this.legacy) return N.refV0 + N.accel * this.t;
    return N.v0 + N.grow * (1 - Math.exp(-this.t / N.tau)) + N.creep * this.t;
  }

  /** Advance by dt of night time (0 while the night waits). */
  advance(dt: number, birdX: number, realDt: number): void {
    const N = CONFIG.night;
    if (this.legacy) {
      this.t += dt;
      this.x = -N.refStartGap + N.refV0 * this.t + 0.5 * N.accel * this.t * this.t - this.legacyPush;
    } else if (dt > 0) {
      this.x += this.speed * dt;
      this.t += dt;
    }
    if (!this.legacy && birdX - this.x > N.maxGap) this.x = birdX - N.maxGap; // full day: no banking
    const gap = birdX - this.x;
    if (!Number.isNaN(this.prevGap) && realDt > 0) {
      const r = (gap - this.prevGap) / realDt / N.daylightGap;
      this.rate += (r - this.rate) * Math.min(1, realDt * N.rateSmooth);
    }
    this.prevGap = gap;
  }

  /** Push the night back by px (capped at maxGap). Returns the daylight actually gained (0..1). */
  push(px: number, birdX: number): number {
    const N = CONFIG.night;
    const x = this.legacy ? this.x - px : Math.max(this.x - px, birdX - N.maxGap);
    const d = this.x - x;
    if (d <= 0) return 0;
    if (this.legacy) this.legacyPush += d;
    this.x = x;
    this.prevGap += d; // a push is a step, not a rate: keep the trend arrow honest
    return Math.min(1, d / N.daylightGap);
  }

  /** 1 = day ... 0 = night. */
  daylight(birdX: number): number {
    const d = (birdX - this.x) / CONFIG.night.daylightGap;
    return d < 0 ? 0 : d > 1 ? 1 : d;
  }
}
