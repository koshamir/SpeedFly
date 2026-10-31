import { CONFIG } from '../config';
import type { Run } from '../sim/run';
import type { LandKind } from '../core/events';
import type { SkyState } from '../render/palette';

export const TIER_LABELS = ['', 'CRUISE', 'FAST', 'BLAZING', 'SONIC'];

const css = (c: number[]): string => `rgb(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)})`;

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent?: HTMLElement, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  parent?.appendChild(e);
  return e;
}

export const fmt = (n: number): string => Math.floor(n).toLocaleString('en-US');

// In-game HUD. DOM is touched only when a shown value changes.
export class Hud {
  readonly root: HTMLDivElement;
  readonly pause: HTMLButtonElement;
  private readonly score: HTMLDivElement;
  private readonly kmh: HTMLSpanElement;
  private readonly tier: HTMLSpanElement;
  private readonly dots: HTMLSpanElement[] = [];
  private readonly dotsBox: HTMLDivElement;
  private readonly dial: HTMLDivElement;
  private readonly orb: HTMLDivElement;
  private roll = 0;
  private lastTarget = 0;
  private shown = { score: -1, kmh: -1, tier: -1, streak: -1, fever: false, day: -1, night: -1 };

  constructor(parent: HTMLElement) {
    this.root = el('div', 'hud', parent);
    this.dial = el('div', 'dial', this.root);
    this.orb = el('div', 'dial-orb', this.dial);
    const box = el('div', 'score-box', this.root);
    this.score = el('div', 'score', box, '0');
    const row = el('div', 'speed-row', box);
    this.kmh = el('span', 'kmh', row, '0');
    el('span', 'kmh-unit', row, 'km/h');
    this.tier = el('span', 'tier', row);
    this.dotsBox = el('div', 'dots', box);
    for (let i = 0; i < CONFIG.score.feverStreak; i++) this.dots.push(el('span', 'dot', this.dotsBox));
    this.pause = el('button', 'btn-round btn-pause', this.root);
    this.pause.setAttribute('data-ui', '');
    this.pause.setAttribute('aria-label', 'Pause');
    el('span', 'bar', this.pause);
    el('span', 'bar', this.pause);
  }

  /** Judged landing: GOOD visibly keeps the streak dots, BAD/SPLASH visibly resets lit ones. */
  landed(kind: LandKind): void {
    const lit = this.shown.streak > 0 || this.shown.fever;
    const cls = kind === 'ok' && lit ? 'keep' : (kind === 'bad' || kind === 'splash') && lit ? 'reset' : '';
    if (!cls) return;
    this.dotsBox.classList.remove('keep', 'reset');
    void this.dotsBox.offsetWidth; // restart the animation
    this.dotsBox.classList.add(cls);
  }

  show(on: boolean): void {
    this.root.classList.toggle('hidden', !on);
  }

  update(dt: number, run: Run, sky: SkyState): void {
    const s = this.shown, J = CONFIG.juice;
    // the counter rolls up to the real score; big jumps bump it
    const target = Math.floor(run.score.total);
    if (target < this.roll) this.roll = target;
    else if (target > this.roll) {
      if (target - this.roll >= J.scoreBump && target - this.lastTarget >= J.scoreBump) {
        this.score.classList.remove('bump');
        void this.score.offsetWidth;
        this.score.classList.add('bump');
      }
      this.roll += (target - this.roll) * (1 - Math.exp(-dt * J.scoreRoll));
      if (target - this.roll < 1) this.roll = target;
    }
    this.lastTarget = target;
    const score = Math.floor(this.roll);
    if (score !== s.score) {
      s.score = score;
      this.score.textContent = fmt(score);
    }
    const kmh = Math.round(run.speed * CONFIG.speed.kmhPerPx);
    if (kmh !== s.kmh) {
      s.kmh = kmh;
      this.kmh.textContent = String(kmh);
    }
    if (run.tier !== s.tier) {
      s.tier = run.tier;
      this.tier.textContent = TIER_LABELS[run.tier] ?? '';
      // spring bump when the tier goes up
      if (run.tier > 0) {
        this.tier.classList.remove('bump');
        void this.tier.offsetWidth;
        this.tier.classList.add('bump');
      }
      this.tier.style.color = CONFIG.colors.tiers[run.tier] ?? '#fff';
      this.kmh.style.color = CONFIG.colors.tiers[run.tier] ?? '#fff';
    }
    const streak = Math.min(run.bird.streak, this.dots.length);
    if (streak !== s.streak || run.fever !== s.fever) {
      s.streak = streak;
      s.fever = run.fever;
      this.dots.forEach((d, i) => d.classList.toggle('on', run.fever || i < streak));
      this.dotsBox.classList.toggle('fever', run.fever);
    }
    // day dial: remaining daylight ring + sky colors, sun -> moon
    const day = Math.round(run.daylight * 200) / 200;
    if (day !== s.day || sky.night !== s.night) {
      s.day = day;
      s.night = sky.night;
      this.dial.style.setProperty('--day', `${day * 360}deg`);
      this.dial.style.setProperty('--top', css(sky.top));
      this.dial.style.setProperty('--hor', css(sky.horizon));
      this.orb.style.background = css(sky.sun);
      this.orb.style.top = `${(1 - sky.sunY) * 100}%`;
      this.orb.classList.toggle('moon', sky.night > 0);
    }
  }
}
