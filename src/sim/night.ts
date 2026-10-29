import { CONFIG } from '../config';

// The night chases the bird: xNight(t) = -startGap + v0 t + accel t^2 / 2 (t from the first touch).
export class Night {
  t = 0;
  push = 0; // each new island pushes the night back

  get x(): number {
    const N = CONFIG.night;
    return -N.startGap + N.v0 * this.t + 0.5 * N.accel * this.t * this.t - this.push;
  }

  /** 1 = day ... 0 = night. */
  daylight(birdX: number): number {
    const d = (birdX - this.x) / CONFIG.night.daylightGap;
    return d < 0 ? 0 : d > 1 ? 1 : d;
  }
}
