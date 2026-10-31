import { CONFIG } from '../config';

// Procedural main soundtrack (no files): a sunny 4-chord loop sequenced with a lookahead scheduler.
// Layers fade in with intensity: pad + soft arp on the title, + bass/drums while playing,
// + bright arp at speed tier 2, + lead melody at tier 3 / Fever. Everything runs through one
// lowpass that opens with the speed tier (same idea as the old optional music.mp3).

const semi = (n: number): number => Math.pow(2, n / 12);
const C3 = 130.81;
// I - V - vi - IV in C, as semitones from C3 (root position triads + a colour tone)
const CHORDS = [
  [0, 4, 7, 14],
  [7, 11, 14, 21],
  [9, 12, 16, 23],
  [5, 9, 12, 19],
];
// lead: one bar per chord, 8 eighth notes, semitones from C5 (null = rest)
const LEAD: (number | null)[][] = [
  [7, null, 9, 7, 4, null, 2, 4],
  [2, null, 7, null, 11, 9, 7, null],
  [9, null, 12, 11, 9, 7, 4, null],
  [5, 7, 9, null, 12, null, 14, 12],
];

export type MusicMood = 'title' | 'play' | 'fever' | 'results' | 'off';

export class Music {
  readonly out: GainNode;
  private filter: BiquadFilterNode;
  private layers: Record<'pad' | 'bass' | 'drums' | 'arp' | 'lead', GainNode>;
  private noise: AudioBuffer;
  private step = 0; // 16th notes since start
  private next = 0; // ctx time of the next 16th
  private timer = 0;
  private mood: MusicMood = 'off';
  private tier = 0;

  constructor(private ctx: AudioContext, dest: AudioNode, noise: AudioBuffer) {
    this.noise = noise;
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.Q.value = 0.6;
    this.filter.frequency.value = CONFIG.audio.musicCut[0];
    this.filter.connect(this.out).connect(dest);
    const mk = (): GainNode => {
      const g = ctx.createGain();
      g.gain.value = 0;
      g.connect(this.filter);
      return g;
    };
    this.layers = { pad: mk(), bass: mk(), drums: mk(), arp: mk(), lead: mk() };
    // drums skip the lowpass: the kick should punch even at tier 0
    this.layers.drums.disconnect();
    this.layers.drums.connect(this.out);
  }

  start(): void {
    if (this.timer) return;
    this.next = this.ctx.currentTime + 0.1;
    this.timer = window.setInterval(() => this.schedule(), 25);
  }

  /** Per frame from Audio.frame: mood + tier drive the layer mix and the filter. */
  set(mood: MusicMood, tier: number): void {
    const t = this.ctx.currentTime, A = CONFIG.audio;
    this.tier = tier;
    if (mood !== this.mood) {
      this.mood = mood;
      const mix = {
        title: { pad: 1, bass: 0, drums: 0, arp: 0.5, lead: 0 },
        play: { pad: 1, bass: 1, drums: 1, arp: tier >= 2 ? 1 : 0.35, lead: tier >= 3 ? 1 : 0 },
        fever: { pad: 1, bass: 1, drums: 1, arp: 1, lead: 1 },
        results: { pad: 1, bass: 0.6, drums: 0, arp: 0.4, lead: 0 },
        off: { pad: 0, bass: 0, drums: 0, arp: 0, lead: 0 },
      }[mood];
      for (const k of Object.keys(mix) as (keyof typeof mix)[]) this.layers[k].gain.setTargetAtTime(mix[k], t, 0.6);
    }
    if (mood === 'play') {
      this.layers.arp.gain.setTargetAtTime(tier >= 2 ? 1 : 0.35, t, 0.6);
      this.layers.lead.gain.setTargetAtTime(tier >= 3 ? 1 : 0, t, 0.6);
    }
    const cut = mood === 'fever' ? A.musicCut[A.musicCut.length - 1] : mood === 'play' ? A.musicCut[Math.min(tier, A.musicCut.length - 1)] : 1800;
    this.filter.frequency.setTargetAtTime(cut, t, 0.4);
    this.out.gain.setTargetAtTime(mood === 'off' ? 0 : A.music, t, mood === 'off' ? 0.5 : 0.3);
  }

  private schedule(): void {
    const ctx = this.ctx;
    if (ctx.state !== 'running') {
      this.next = ctx.currentTime + 0.05;
      return;
    }
    const sixteenth = 60 / CONFIG.audio.bpm / 4;
    if (this.next < ctx.currentTime - 0.2) this.next = ctx.currentTime + 0.02; // resumed after a pause
    while (this.next < ctx.currentTime + 0.12) {
      this.play(this.step, this.next, sixteenth);
      this.next += sixteenth;
      this.step++;
    }
  }

  private play(s: number, t: number, d16: number): void {
    const bar = Math.floor(s / 16) % 4, pos = s % 16, chord = CHORDS[bar];
    const L = this.layers;
    // pad: whole-bar chord, two detuned saws per note
    if (pos === 0) for (const n of chord.slice(0, 3)) for (const dt of [-8, 8]) this.voice('sawtooth', C3 * 2 * semi(n), t, 0.022, 0.4, d16 * 16, L.pad, dt);
    // bass: root on 1 and the "and" of 2, fifth on 3
    if (pos === 0 || pos === 6 || pos === 8 || pos === 14) {
      const n = chord[0] + (pos === 8 ? 7 : 0);
      this.voice('triangle', (C3 / 2) * semi(n), t, 0.3, 0.005, d16 * (pos === 6 || pos === 14 ? 1.5 : 3), L.bass);
    }
    // drums: kick 1/3, snare-ish clap 2/4, offbeat hats (+16ths at tier 3)
    if (pos % 8 === 0) this.kick(t);
    if (pos === 4 || pos === 12) this.hat(t, 0.16, 1800, 0.12);
    if (pos % 4 === 2 || (this.tier >= 3 && pos % 2 === 1)) this.hat(t, pos % 4 === 2 ? 0.07 : 0.035, 7000, 0.04);
    // arp: chord tones up two octaves, every 16th
    const an = chord[pos % 4] + 12 * (Math.floor(pos / 4) % 2) + 12;
    this.voice('square', C3 * semi(an), t, 0.03, 0.003, d16 * 0.9, L.arp);
    // lead: eighth notes
    if (pos % 2 === 0) {
      const n = LEAD[bar][pos / 2];
      if (n !== null) {
        this.voice('triangle', C3 * 4 * semi(n), t, 0.09, 0.01, d16 * 2.6, L.lead);
        this.voice('sine', C3 * 8 * semi(n), t, 0.025, 0.01, d16 * 1.5, L.lead);
      }
    }
  }

  private voice(type: OscillatorType, f: number, t: number, peak: number, attack: number, dur: number, dest: AudioNode, detune = 0): void {
    const ctx = this.ctx;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type;
    o.frequency.value = f;
    o.detune.value = detune;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + dur);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + attack + dur + 0.05);
  }

  private kick(t: number): void {
    const ctx = this.ctx;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
    g.gain.setValueAtTime(0.5, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
    o.connect(g).connect(this.layers.drums);
    o.start(t);
    o.stop(t + 0.3);
  }

  private hat(t: number, peak: number, freq: number, dur: number): void {
    const ctx = this.ctx;
    const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = this.noise;
    f.type = 'highpass';
    f.frequency.value = freq;
    g.gain.setValueAtTime(peak, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(this.layers.drums);
    s.start(t, Math.random() * 1.5);
    s.stop(t + dur + 0.02);
  }
}
