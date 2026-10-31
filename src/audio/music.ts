import { CONFIG } from '../config';

// Background soundtrack, synthesized (no assets): a warm, sunny loop — soft pad chords, a round bass, a
// plucked pentatonic arpeggio and light shaker ticks. A small look-ahead scheduler (setInterval) queues
// notes ~0.25 s ahead on the AudioContext clock. intensity 0..1 (speed tier) opens the filter and adds
// arpeggio notes; duck() dips it under stings. Everything goes through one gain -> master.

const semi = (n: number): number => Math.pow(2, n / 12);
// I - vi - IV - V in C (maj7 / m7 / maj7 / 6 colours), two bars each
const CHORDS = [
  [0, 4, 7, 11],
  [-3, 0, 4, 7],
  [-7, -3, 0, 4],
  [-5, -1, 2, 4],
];
const ROOT = 261.63; // C4
const ARP = [0, 2, 4, 7, 9, 12, 14, 16]; // C major pentatonic, 2 octaves

export class Music {
  private readonly out: GainNode;
  private readonly lp: BiquadFilterNode;
  private readonly noise: AudioBuffer;
  private timer = 0;
  private next = 0; // ctx time of the next 8th note
  private step = 0;
  private intensity = 0;
  private seed = 1;

  constructor(
    private readonly ctx: AudioContext,
    dest: AudioNode,
  ) {
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.lp = ctx.createBiquadFilter();
    this.lp.type = 'lowpass';
    this.lp.frequency.value = 1400;
    this.lp.Q.value = 0.4;
    this.lp.connect(this.out).connect(dest);
    this.noise = ctx.createBuffer(1, ctx.sampleRate * 0.2, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }

  start(): void {
    if (this.timer) return;
    this.next = this.ctx.currentTime + 0.1;
    this.timer = window.setInterval(() => this.schedule(), 60);
  }

  stop(): void {
    clearInterval(this.timer);
    this.timer = 0;
  }

  /** Per frame: level (0 = silent), intensity 0..1. */
  set(level: number, intensity: number): void {
    const t = this.ctx.currentTime;
    this.intensity = intensity;
    this.out.gain.setTargetAtTime(level * CONFIG.audio.music, t, 0.6);
    this.lp.frequency.setTargetAtTime(900 + 3200 * intensity, t, 0.5);
  }

  /** Dip under a sting / chord for a moment. */
  duck(seconds = 1.6): void {
    const g = this.out.gain, t = this.ctx.currentTime, v = g.value;
    g.cancelScheduledValues(t);
    g.setValueAtTime(v, t);
    g.linearRampToValueAtTime(v * 0.25, t + 0.08);
    g.setTargetAtTime(v, t + seconds, 0.4);
  }

  private rnd(): number {
    this.seed = (this.seed * 16807) % 2147483647;
    return this.seed / 2147483647;
  }

  private schedule(): void {
    const ctx = this.ctx, A = CONFIG.audio;
    if (ctx.state !== 'running') {
      this.next = ctx.currentTime + 0.1;
      return;
    }
    const eighth = 30 / A.musicBpm;
    while (this.next < ctx.currentTime + 0.25) {
      const s = this.step, t = this.next;
      const chord = CHORDS[Math.floor(s / 16) % CHORDS.length];
      if (s % 16 === 0) this.pad(t, chord, eighth * 16);
      if (s % 4 === 0) this.bass(t, chord[0] - 12, eighth * (s % 8 === 0 ? 3 : 1.5));
      // arpeggio: busier and higher with intensity
      const p = 0.35 + 0.55 * this.intensity;
      if (s % 2 === 0 || this.rnd() < p * 0.5) {
        if (this.rnd() < p) {
          const n = ARP[Math.floor(this.rnd() * (4 + 4 * this.intensity))];
          this.pluck(t, n + 12 * (this.rnd() < 0.2 ? 1 : 0));
        }
      }
      if (s % 2 === 1) this.tick(t, 0.025 + 0.03 * this.intensity);
      this.next += eighth;
      this.step++;
    }
  }

  private env(t: number, peak: number, a: number, d: number): GainNode {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
    g.connect(this.lp);
    return g;
  }

  private osc(type: OscillatorType, f: number, t: number, peak: number, a: number, d: number, detune = 0): void {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.value = f;
    o.detune.value = detune;
    o.connect(this.env(t, peak, a, d));
    o.start(t);
    o.stop(t + a + d + 0.05);
  }

  private pad(t: number, chord: number[], len: number): void {
    for (const n of chord) {
      const f = ROOT * semi(n);
      this.osc('triangle', f, t, 0.045, 0.6, len, -6);
      this.osc('triangle', f, t, 0.045, 0.6, len, 6);
    }
  }

  private bass(t: number, n: number, len: number): void {
    this.osc('sine', ROOT * semi(n), t, 0.16, 0.02, len);
  }

  private pluck(t: number, n: number): void {
    const f = ROOT * 2 * semi(n);
    this.osc('triangle', f, t, 0.055, 0.004, 0.35);
    this.osc('sine', f * 2, t, 0.015, 0.002, 0.15);
  }

  private tick(t: number, peak: number): void {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise;
    const hp = this.ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 6000;
    s.connect(hp).connect(this.env(t, peak, 0.002, 0.05));
    s.start(t);
    s.stop(t + 0.08);
  }
}
