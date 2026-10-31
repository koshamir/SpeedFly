import { CONFIG } from '../config';
import type { GameBus } from '../core/events';
import { load, save } from '../core/storage';
import { Music, type MusicMood } from './music';

// WebAudio, all SFX synthesized (§8). Unlocked on the first press; master -> limiter -> out.
// Subscribes to the bus only. Optional music: drop a loop at src/audio/music.mp3 (bundled when
// present; absent = no request at all), its lowpass opens with the speed tier.

const musicUrl = Object.values(import.meta.glob('./music.mp3', { query: '?url', import: 'default', eager: true }))[0] as string | undefined;

const PENTA = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24, 26, 28, 31];
const semi = (n: number): number => Math.pow(2, n / 12);

export class Audio {
  muted = load('mute') === '1';
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfx!: GainNode;
  private noise!: AudioBuffer;
  private windGain!: GainNode;
  private windFilter!: BiquadFilterNode;
  private shimmer: { gain: GainNode; stop: () => void } | null = null;
  private musicFilter: BiquadFilterNode | null = null;
  private musicGain: GainNode | null = null;
  private tier = 0;
  private music: Music | null = null;
  private mood: 'title' | 'play' | 'results' | 'off' = 'title';
  private fever = false;
  private running = true;
  private jumping = false; // scripted island jump in progress (the apex sting replaces the fanfare)

  constructor(bus: GameBus) {
    bus.on('land', (e) => {
      if (e.kind === 'splash') this.splash(e.speed);
      else {
        this.thud(e.kind === 'bad', e.speed);
        if (e.kind === 'great') this.bell(e.streak);
      }
    });
    bus.on('feverStart', () => ((this.fever = true), this.feverStart()));
    bus.on('feverEnd', () => ((this.fever = false), this.feverEnd()));
    bus.on('coin', (e) => (e.type === 'blue' ? this.whoosh() : this.blip(e.chain)));
    bus.on('skyTouch', () => this.airBell());
    bus.on('island', () => !this.jumping && this.fanfare());
    bus.on('islandLaunch', (e) => {
      this.jumping = true;
      this.launch(e.duration * ((e.apexX - e.x) / Math.max(1, e.targetX - e.x)));
    });
    bus.on('islandLand', () => {
      this.jumping = false;
      this.landChord();
    });
    bus.on('caught', () => ((this.fever = false), (this.mood = 'off'), this.nightfall()));
    bus.on('speedTier', (e) => {
      if (e.tier > e.prev) this.tierUp(e.tier);
      this.tier = e.tier;
    });
    bus.on('takeoff', (e) => this.swish(e.speed));
  }

  /** Call from a user gesture (first pointerdown / key): creates or resumes the context (iOS too). */
  unlock(): void {
    if (!this.ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      try {
        this.ctx = new AC();
      } catch {
        return;
      }
      this.build();
    }
    if (this.running && this.ctx.state !== 'running') void this.ctx.resume().catch(() => undefined);
    // iOS: a silent one-sample buffer played inside the gesture unlocks output
    const b = this.ctx.createBufferSource();
    b.buffer = this.ctx.createBuffer(1, 1, 22050);
    b.connect(this.ctx.destination);
    b.start();
  }

  setMuted(m: boolean): void {
    this.muted = m;
    save('mute', m ? '1' : '0');
    if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : CONFIG.audio.master, this.ctx.currentTime, 0.03);
  }

  /** Pause / hide: suspend the whole graph; resume on return (needs a prior unlock). */
  setRunning(on: boolean): void {
    this.running = on;
    if (!this.ctx) return;
    if (on) void this.ctx.resume().catch(() => undefined);
    else void this.ctx.suspend().catch(() => undefined);
  }

  /** Game state -> soundtrack mood (title / playing / results). */
  setMood(m: 'title' | 'play' | 'results' | 'off'): void {
    this.mood = m;
    if (m !== 'play') this.fever = false;
  }

  /** Per frame: wind + music follow the speed. live = being played; flight = island-jump shot 0..1. */
  frame(speed: number, diving: boolean, live: boolean, flight = 0): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const A = CONFIG.audio, t = ctx.currentTime;
    const k = live ? Math.min(1, speed / A.windFullSpeed) : 0;
    const f = live ? flight : 0;
    const g = A.wind * Math.pow(k, 1.3) * (diving ? A.windDive : 1);
    this.windGain.gain.setTargetAtTime(g + (A.flightWind - g) * f, t, 0.12);
    const cut = A.windCut0 + (A.windCut1 - A.windCut0) * k * (diving ? 1.25 : 1);
    this.windFilter.frequency.setTargetAtTime(cut + (A.flightWindCut - cut) * f, t, 0.12);
    if (this.music) {
      const m: MusicMood = this.mood === 'play' && this.fever ? 'fever' : this.mood;
      this.music.set(m, this.tier);
    }
    if (this.musicFilter && this.musicGain) {
      this.musicFilter.frequency.setTargetAtTime(A.musicCut[Math.min(this.tier, A.musicCut.length - 1)], t, 0.4);
      this.musicGain.gain.setTargetAtTime(live ? A.music : A.music * 0.5, t, 0.5);
    }
  }

  private build(): void {
    const ctx = this.ctx!, A = CONFIG.audio;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -8;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.12;
    limiter.connect(ctx.destination);
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : A.master;
    this.master.connect(limiter);
    this.sfx = ctx.createGain();
    this.sfx.gain.value = A.sfx;
    this.sfx.connect(this.master);
    // 2 s of white noise, shared by wind / thuds / splashes
    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    // wind loop
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'bandpass';
    this.windFilter.Q.value = 0.7;
    this.windFilter.frequency.value = A.windCut0;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    src.connect(this.windFilter).connect(this.windGain).connect(this.master);
    src.start();
    if (musicUrl) void this.loadMusic(musicUrl);
    else {
      this.music = new Music(ctx, this.master, this.noise);
      this.music.start();
    }
  }

  private async loadMusic(url: string): Promise<void> {
    const ctx = this.ctx!;
    try {
      const buf = await ctx.decodeAudioData(await (await fetch(url)).arrayBuffer());
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      this.musicFilter = ctx.createBiquadFilter();
      this.musicFilter.type = 'lowpass';
      this.musicFilter.frequency.value = CONFIG.audio.musicCut[0];
      this.musicGain = ctx.createGain();
      this.musicGain.gain.value = 0;
      src.connect(this.musicFilter).connect(this.musicGain).connect(this.master);
      src.start();
    } catch {
      // no music: the game stays silent apart from SFX
    }
  }

  // ---------- voices ----------
  private ok(): AudioContext | null {
    return this.ctx && this.ctx.state === 'running' && !this.muted ? this.ctx : null;
  }

  private env(ctx: AudioContext, t: number, peak: number, attack: number, decay: number, dest: AudioNode = this.sfx): GainNode {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    g.connect(dest);
    return g;
  }

  private tone(type: OscillatorType, f0: number, f1: number, t: number, peak: number, attack: number, decay: number, dest?: AudioNode): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + attack + decay * 0.7);
    o.connect(this.env(ctx, t, peak, attack, decay, dest));
    o.start(t);
    o.stop(t + attack + decay + 0.05);
  }

  private noiseHit(t: number, type: BiquadFilterType, f0: number, f1: number, q: number, peak: number, attack: number, decay: number): void {
    const ctx = this.ctx!;
    const s = ctx.createBufferSource();
    s.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(f1, t + attack + decay);
    s.connect(f).connect(this.env(ctx, t, peak, attack, decay));
    s.start(t, Math.random() * 1.5);
    s.stop(t + attack + decay + 0.05);
  }

  private thud(bad: boolean, speed: number): void {
    const ctx = this.ok();
    if (!ctx) return;
    const t = ctx.currentTime, k = Math.min(1, 0.4 + speed / 2000);
    if (bad) {
      this.tone('sine', 110, 40, t, 0.9 * k, 0.004, 0.22);
      this.noiseHit(t, 'lowpass', 900, 200, 0.7, 0.5 * k, 0.003, 0.16);
      // boing: a springy pitch wobble
      const o = ctx.createOscillator(), lfo = ctx.createOscillator(), lg = ctx.createGain();
      o.type = 'triangle';
      o.frequency.setValueAtTime(170, t + 0.03);
      o.frequency.exponentialRampToValueAtTime(330, t + 0.12);
      o.frequency.exponentialRampToValueAtTime(140, t + 0.4);
      lfo.frequency.value = 22;
      lg.gain.value = 30;
      lfo.connect(lg).connect(o.frequency);
      o.connect(this.env(ctx, t + 0.03, 0.35, 0.01, 0.38));
      o.start(t + 0.03);
      lfo.start(t + 0.03);
      o.stop(t + 0.5);
      lfo.stop(t + 0.5);
    } else {
      this.tone('sine', 150, 60, t, 0.55 * k, 0.003, 0.14);
      this.noiseHit(t, 'lowpass', 1400, 300, 0.7, 0.28 * k, 0.002, 0.1);
    }
  }

  private bell(streak: number): void {
    const ctx = this.ok();
    if (!ctx) return;
    const t = ctx.currentTime + 0.01;
    const f = CONFIG.audio.bellBase * semi(PENTA[Math.min(streak - 1, PENTA.length - 1)]);
    this.tone('sine', f, f, t, 0.32, 0.004, 0.9);
    this.tone('sine', f * 2.76, f * 2.76, t, 0.1, 0.002, 0.35);
    this.tone('triangle', f * 2, f * 2, t, 0.08, 0.004, 0.5);
  }

  private blip(chain: number): void {
    const ctx = this.ok();
    if (!ctx) return;
    const t = ctx.currentTime;
    const f = CONFIG.audio.coinBase * semi(PENTA[Math.min(chain, PENTA.length - 1)]);
    this.tone('square', f, f, t, 0.07, 0.002, 0.07);
    this.tone('sine', f * 2, f * 2, t + 0.04, 0.09, 0.002, 0.1);
  }

  private whoosh(): void {
    const ctx = this.ok();
    if (!ctx) return;
    const t = ctx.currentTime;
    this.noiseHit(t, 'bandpass', 400, 4000, 2, 0.45, 0.06, 0.32);
    this.tone('sine', 520, 1560, t, 0.15, 0.01, 0.3);
  }

  private airBell(): void {
    const ctx = this.ok();
    if (!ctx) return;
    const t = ctx.currentTime;
    this.noiseHit(t, 'highpass', 3000, 6000, 0.5, 0.12, 0.08, 0.6);
    for (const [r, a] of [[1, 0.22], [1.5, 0.12], [2.01, 0.08]]) this.tone('sine', 1320 * r, 1320 * r, t, a, 0.03, 1.4);
  }

  private fanfare(): void {
    const ctx = this.ok();
    if (!ctx) return;
    const t = ctx.currentTime;
    const notes = [523.25, 659.25, 783.99];
    notes.forEach((f, i) => {
      const d = i === 2 ? 0.7 : 0.16;
      this.tone('triangle', f, f, t + i * 0.13, 0.22, 0.01, d);
      this.tone('square', f, f, t + i * 0.13, 0.05, 0.01, d * 0.8);
    });
    this.tone('triangle', 1046.5, 1046.5, t + 0.26, 0.1, 0.02, 0.8);
  }

  /** Island jump take-off: a whoosh that rises with the climb (rise = s to the apex). */
  private launch(rise: number): void {
    const ctx = this.ok();
    if (!ctx) return;
    const t = ctx.currentTime, d = Math.max(0.6, Math.min(2.5, rise));
    this.noiseHit(t, 'bandpass', 300, 3600, 1.6, 0.5, 0.25, d);
    this.tone('sine', 196, 784, t, 0.16, 0.2, d);
    this.tone('triangle', 392, 1568, t + 0.05, 0.05, 0.25, d);
  }

  /** Apex of the island jump: a soaring chord (rolled, long tail). Called by main at the apex. */
  sting(): void {
    const ctx = this.ok();
    if (!ctx) return;
    const t = ctx.currentTime, a = CONFIG.audio.sting;
    // Cmaj9 rolled upward + a soft detuned pad
    [523.25, 659.25, 783.99, 987.77, 1174.66].forEach((f, i) => {
      this.tone('triangle', f, f, t + i * 0.07, a, 0.02, 1.6);
      this.tone('sine', f * 2, f * 2, t + i * 0.07, a * 0.3, 0.01, 0.8);
    });
    for (const [f, dt] of [[261.63, -6], [392, 6]] as const) {
      const ctx2 = this.ctx!;
      const o = ctx2.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      o.detune.value = dt;
      const lp = ctx2.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 1400;
      o.connect(lp).connect(this.env(ctx2, t, a * 0.35, 0.35, 1.8));
      o.start(t);
      o.stop(t + 2.3);
    }
  }

  /** A visual bump on the mountain descent: a soft low thump. */
  bump(): void {
    const ctx = this.ok();
    if (!ctx) return;
    const t = ctx.currentTime, a = CONFIG.audio.bump;
    this.tone('sine', 120, 70, t, a, 0.003, 0.12);
    this.noiseHit(t, 'lowpass', 900, 250, 0.7, a * 0.5, 0.002, 0.08);
  }

  /** Island touchdown: a bright, splashy major chord. */
  private landChord(): void {
    const ctx = this.ok();
    if (!ctx) return;
    const t = ctx.currentTime + 0.01, a = CONFIG.audio.landChord;
    this.noiseHit(t, 'highpass', 5000, 9000, 0.6, 0.18, 0.004, 0.35);
    [1046.5, 1318.5, 1568, 2093].forEach((f, i) => {
      this.tone('sine', f, f, t + i * 0.025, a, 0.004, 1.1);
      this.tone('sine', f * 2.76, f * 2.76, t + i * 0.025, a * 0.25, 0.002, 0.3);
    });
    this.tone('triangle', 523.25, 523.25, t, a * 0.6, 0.01, 0.9);
  }

  private nightfall(): void {
    this.feverEnd();
    const ctx = this.ok();
    if (!ctx) return;
    const t = ctx.currentTime;
    [659.25, 523.25, 440, 329.63].forEach((f, i) => this.tone('sine', f, f, t + i * 0.28, 0.18, 0.04, 0.9));
  }

  private feverStart(): void {
    const ctx = this.ok();
    if (!ctx) return;
    const t = ctx.currentTime;
    const base = 523.25;
    [0, 4, 7, 12, 16, 19, 24].forEach((n, i) => this.tone('triangle', base * semi(n), base * semi(n), t + i * 0.055, 0.14, 0.005, 0.25));
    // shimmering loop: detuned triangles with a tremolo, until feverEnd
    if (this.shimmer) return;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(CONFIG.audio.shimmer, t + 0.5);
    gain.connect(this.sfx);
    const trem = ctx.createGain();
    trem.gain.value = 0.6;
    const lfo = ctx.createOscillator(), lg = ctx.createGain();
    lfo.frequency.value = 7;
    lg.gain.value = 0.4;
    lfo.connect(lg).connect(trem.gain);
    trem.connect(gain);
    const oscs = [0, 7, 12, 16].map((n, i) => {
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = base * 2 * semi(n);
      o.detune.value = i % 2 ? 7 : -7;
      o.connect(trem);
      o.start(t);
      return o;
    });
    lfo.start(t);
    this.shimmer = {
      gain,
      stop: () => {
        const now = ctx.currentTime;
        gain.gain.cancelScheduledValues(now);
        gain.gain.setTargetAtTime(0.0001, now, 0.15);
        for (const o of oscs) o.stop(now + 0.8);
        lfo.stop(now + 0.8);
      },
    };
  }

  private feverEnd(): void {
    this.shimmer?.stop();
    this.shimmer = null;
  }

  private splash(speed: number): void {
    const ctx = this.ok();
    if (!ctx) return;
    const t = ctx.currentTime, k = Math.min(1, 0.5 + speed / 2000);
    this.noiseHit(t, 'lowpass', 2500, 300, 0.8, 0.6 * k, 0.005, 0.5);
    this.tone('sine', 300, 80, t, 0.3 * k, 0.005, 0.25);
  }

  /** Leaving the ground: a short airy swish, brighter with speed. */
  private swish(speed: number): void {
    const ctx = this.ok();
    if (!ctx) return;
    const t = ctx.currentTime, k = Math.min(1, speed / CONFIG.audio.windFullSpeed);
    this.noiseHit(t, 'bandpass', 600 + 900 * k, 2400 + 3000 * k, 1.2, CONFIG.audio.swish * (0.4 + 0.6 * k), 0.03, 0.18);
  }

  /** Speed tier up: a quick rising riser + a sparkly chime on the new tier's note. */
  private tierUp(tier: number): void {
    const ctx = this.ok();
    if (!ctx) return;
    const t = ctx.currentTime, a = CONFIG.audio.tierUp;
    this.noiseHit(t, 'bandpass', 500, 6000, 2, a * 0.8, 0.18, 0.12);
    this.tone('sawtooth', 220, 880, t, a * 0.25, 0.2, 0.1);
    const f = 523.25 * semi([0, 4, 7, 12, 16, 19][Math.min(tier, 5)]);
    this.tone('sine', f, f, t + 0.22, a, 0.004, 0.6);
    this.tone('sine', f * 2, f * 2, t + 0.22, a * 0.4, 0.004, 0.4);
  }

  /** Run start: a bouncy "go" up-sweep. */
  go(): void {
    const ctx = this.ok();
    if (!ctx) return;
    const t = ctx.currentTime;
    this.tone('square', 392, 392, t, 0.06, 0.004, 0.08);
    this.tone('square', 784, 784, t + 0.09, 0.07, 0.004, 0.2);
    this.tone('sine', 300, 1200, t, 0.18, 0.01, 0.25);
  }

  /** Results screen: a short jingle (bigger on a new best). */
  results(best: boolean): void {
    const ctx = this.ok();
    if (!ctx) return;
    const t = ctx.currentTime;
    const notes = best ? [0, 4, 7, 12, 16, 19, 24] : [0, 4, 7, 12];
    notes.forEach((n, i) => {
      const f = 392 * semi(n), last = i === notes.length - 1;
      this.tone('triangle', f, f, t + i * 0.09, 0.16, 0.005, last ? 0.9 : 0.15);
      if (last) this.tone('sine', f * 2, f * 2, t + i * 0.09, 0.06, 0.005, 1.2);
    });
  }

  /** The night is close: two low pulsing tones (a heartbeat-ish warning). */
  nightWarn(): void {
    const ctx = this.ok();
    if (!ctx) return;
    const t = ctx.currentTime, a = CONFIG.audio.nightWarn;
    for (const dt of [0, 0.22]) {
      this.tone('sine', 98, 70, t + dt, a, 0.01, 0.25);
      this.tone('triangle', 196, 185, t + dt, a * 0.35, 0.01, 0.2);
    }
  }

  /** Passing the best distance: a bright rising arpeggio. */
  record(): void {
    const ctx = this.ok();
    if (!ctx) return;
    const t = ctx.currentTime;
    [0, 4, 7, 12, 16, 19, 24, 28].forEach((n, i) => {
      const f = 523.25 * semi(n);
      this.tone('triangle', f, f, t + i * 0.05, 0.14, 0.004, i === 7 ? 1 : 0.18);
      this.tone('square', f, f, t + i * 0.05, 0.03, 0.004, 0.12);
    });
    this.noiseHit(t, 'highpass', 4000, 9000, 0.6, 0.12, 0.01, 0.6);
  }

  /** Button tap. */
  click(): void {
    const ctx = this.ok();
    if (!ctx) return;
    this.tone('sine', 900, 600, ctx.currentTime, 0.12, 0.002, 0.06);
  }

  /** Sonic boom: low crack + sub drop. */
  boom(): void {
    const ctx = this.ok();
    if (!ctx) return;
    const t = ctx.currentTime;
    this.noiseHit(t, 'lowpass', 1800, 120, 0.9, 0.9, 0.003, 0.7);
    this.tone('sine', 90, 32, t, 0.9, 0.004, 0.6);
    this.noiseHit(t + 0.02, 'bandpass', 3000, 900, 1.5, 0.25, 0.002, 0.18);
  }
}
