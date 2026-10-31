import { CONFIG } from '../config';

/**
 * Automatic quality step-down (M5): when the average frame time stays above perf.slowFrame for
 * perf.slowFor seconds of play, drop one level (DPR 2 -> 1.5 -> 1, fewer particles, no grain).
 * Never steps back up (no oscillation). ?quality=N pins a level and disables the automatic part.
 */
export class Quality {
  level = 0;
  private readonly auto: boolean;
  private winT = 0;
  private winN = 0;
  private slowT = 0;
  private settle = 0;

  constructor(pinned: number | null) {
    this.auto = pinned === null;
    if (pinned !== null) this.level = Math.max(0, Math.min(CONFIG.perf.dpr.length - 1, pinned));
  }

  get dpr(): number {
    return CONFIG.perf.dpr[this.level];
  }
  get particles(): number {
    return CONFIG.perf.particles[this.level];
  }
  get grain(): number {
    return CONFIG.perf.grain[this.level];
  }

  /** Feed every frame while the game is being played; true = the level just dropped. */
  update(dt: number): boolean {
    const P = CONFIG.perf;
    if (!this.auto || this.level >= P.dpr.length - 1 || dt <= 0 || dt > 0.2) return false;
    if (this.settle > 0) {
      this.settle -= dt;
      return false;
    }
    this.winT += dt;
    this.winN++;
    if (this.winT < 0.5) return false;
    const avg = this.winT / this.winN;
    this.slowT = avg > P.slowFrame ? this.slowT + this.winT : 0;
    this.winT = this.winN = 0;
    if (this.slowT < P.slowFor) return false;
    this.level++;
    this.slowT = 0;
    this.settle = 1; // the resize itself costs a frame or two
    return true;
  }
}
