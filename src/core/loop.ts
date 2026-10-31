import { CONFIG } from '../config';

// Fixed timestep (CONFIG.physics.dt, max CONFIG.loop.maxSteps per frame) + interpolated rendering.
export class Loop {
  /** Fixed steps run only while true (title/pause/results still render). */
  simulate = false;
  alpha = 1;
  /** Pacing of the fixed steps (slow-mo < 1). Scales the accumulator only: the step dt never changes. */
  timeScale = 1;
  private acc = 0;
  private last = -1;
  private raf = 0;

  constructor(
    private readonly onStep: () => void,
    private readonly onFrame: (dt: number, alpha: number) => void,
  ) {}

  start(): void {
    if (this.raf) return;
    this.last = -1;
    this.raf = requestAnimationFrame(this.tick);
  }

  stop(): void {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  private readonly tick = (now: number): void => {
    this.raf = requestAnimationFrame(this.tick);
    const dt = this.last < 0 ? 0 : Math.min((now - this.last) / 1000, CONFIG.loop.maxFrame);
    this.last = now;
    const DT = CONFIG.physics.dt;
    if (this.simulate) {
      this.acc += dt * this.timeScale;
      let n = 0;
      while (this.simulate && this.acc >= DT && n < CONFIG.loop.maxSteps) {
        this.onStep();
        this.acc -= DT;
        n++;
      }
      if (this.acc > DT) this.acc = DT; // too slow: drop time instead of spiralling
      this.alpha = this.simulate ? this.acc / DT : 1;
    } else {
      this.acc = 0;
      this.alpha = 1;
    }
    this.onFrame(dt, this.alpha);
  };
}
