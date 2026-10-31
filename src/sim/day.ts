import { CONFIG } from '../config';

// Daylight budget (endless run, SPEC §5): "speed and skill buy daylight".
//   left    seconds of daylight remaining (the sun sinks as it shrinks; 0 = night catches the bird)
//   drain   per second = (1 + t * drainGrow) * speedFactor   (slow birds lose daylight faster)
//   gains   GREAT (more with the streak), Fever (per second), sky touch, a new island (a big chunk)
// The island-end sequence pauses the drain (Run). Deterministic, no DOM.
export class DayClock {
  left = CONFIG.day.start;
  t = 0;
  /** Smoothed d(left)/dt: > 0 = the night retreats, < 0 = it approaches. */
  trend = 0;
  private last = CONFIG.day.start;

  /** One fixed step. paused = island-end sequence. */
  step(dt: number, speed: number, fever: boolean, paused: boolean): void {
    const D = CONFIG.day;
    if (!paused) {
      this.t += dt;
      const k = Math.min(1, Math.max(0, (speed - D.vSlow) / (D.vFast - D.vSlow)));
      const drain = (1 + this.t * D.drainGrow) * (D.slowMul + (D.fastMul - D.slowMul) * k);
      this.left -= drain * dt;
      if (fever) this.left += D.fever * dt;
    }
    this.left = Math.min(D.max, this.left);
    this.trend += ((this.left - this.last) / dt - this.trend) * (1 - Math.exp(-dt / D.trendTau));
    this.last = this.left;
  }

  /** Daylight gain (clamped to max); returns the amount actually added. */
  gain(s: number): number {
    const before = this.left;
    this.left = Math.min(CONFIG.day.max, this.left + s);
    return this.left - before;
  }

  /** 1 = full day ... 0 = night (drives the sky). */
  get daylight(): number {
    return Math.min(1, Math.max(0, this.left / CONFIG.day.full));
  }
}
