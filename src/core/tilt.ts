import { CONFIG } from '../config';

// Tilt control (phones): tilting the phone to the RIGHT = holding a finger; back to neutral = release.
// deviceorientation gamma (left/right tilt in portrait), relative to a calibrated neutral angle.
// No smoothing (timing matters): a dead zone + hysteresis keep it from flickering; the added latency
// is one sensor event (~16 ms at 60 Hz sensors). iOS needs requestPermission() from a user tap.

type OrientationCtor = typeof DeviceOrientationEvent & { requestPermission?: () => Promise<'granted' | 'denied'> };

export class Tilt {
  enabled = false;
  pressed = false;
  /** Last raw gamma (deg) and the neutral it is measured from. */
  gamma = 0;
  neutral = 0;
  /** ms between the last two sensor events (latency readout). */
  interval = 0;
  private seen = false;
  private lastT = 0;

  /** Sensors exist at all (desktop: hidden option). */
  static available(): boolean {
    return typeof window !== 'undefined' && 'DeviceOrientationEvent' in window && matchMedia('(pointer: coarse)').matches;
  }

  /** Call from a tap. Resolves to a user-facing error or '' when tilt works. */
  async enable(): Promise<string> {
    const C = window.DeviceOrientationEvent as OrientationCtor | undefined;
    if (!C) return 'No motion sensor — touch control stays on.';
    if (typeof C.requestPermission === 'function') {
      try {
        if ((await C.requestPermission()) !== 'granted') return 'Motion access denied — touch control stays on.';
      } catch {
        return 'Motion access denied — touch control stays on.';
      }
    }
    window.addEventListener('deviceorientation', this.onOrient);
    this.seen = false;
    await new Promise((r) => setTimeout(r, 700));
    if (!this.seen) {
      this.disable();
      return 'No motion sensor data — touch control stays on.';
    }
    this.enabled = true;
    this.calibrate();
    return '';
  }

  disable(): void {
    window.removeEventListener('deviceorientation', this.onOrient);
    this.enabled = false;
    this.pressed = false;
  }

  /** The current angle becomes neutral. */
  calibrate(): void {
    this.neutral = this.gamma;
    this.pressed = false;
  }

  private readonly onOrient = (e: DeviceOrientationEvent): void => {
    if (e.gamma === null) return;
    this.seen = true;
    const now = performance.now();
    this.interval = this.lastT ? now - this.lastT : 0;
    this.lastT = now;
    this.gamma = e.gamma;
    if (!this.enabled) return;
    const T = CONFIG.tilt, d = this.gamma - this.neutral;
    if (!this.pressed && d > T.threshold) this.pressed = true;
    else if (this.pressed && d < T.threshold - T.hysteresis) this.pressed = false;
  };
}
