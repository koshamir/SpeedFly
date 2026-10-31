import { CONFIG } from '../config';
import { el } from './hud';

export type PopupKind = 'great' | 'points' | 'fever' | 'sky' | 'boost' | 'splash' | 'bad';

interface Popup {
  e: HTMLDivElement;
  age: number;
  lift: number; // logical px above the bird
}

// Popups near the bird: bounce, rise, fade (CSS). They track the bird (ahead and above it, so they
// never cover it). Fixed pool, the oldest is reused.
export class Popups {
  private readonly pool: Popup[] = [];
  private next = 0;
  private readonly banner: HTMLDivElement;
  private readonly bannerMain: HTMLDivElement;
  private readonly bannerSub: HTMLDivElement;
  private bannerTimer = 0;

  constructor(parent: HTMLElement) {
    for (let i = 0; i < CONFIG.ui.popupMax; i++) this.pool.push({ e: el('div', 'popup', parent), age: 1e9, lift: 0 });
    this.banner = el('div', 'banner', parent);
    this.bannerMain = el('div', 'banner-main', this.banner);
    this.bannerSub = el('div', 'banner-sub', this.banner);
    parent.style.setProperty('--pop-life', `${CONFIG.ui.popupLife}s`);
    parent.style.setProperty('--pop-rise', String(CONFIG.ui.popupRise));
  }

  show(kind: PopupKind, text: string, lift: number): void {
    const p = this.pool[this.next];
    this.next = (this.next + 1) % this.pool.length;
    p.age = 0;
    p.lift = lift;
    p.e.textContent = text;
    p.e.className = 'popup';
    void p.e.offsetWidth; // restart the animation
    p.e.className = `popup show ${kind}`;
  }

  /** bx, by: bird on screen (CSS px); u: CSS px per logical px; w: game width (CSS px). */
  update(dt: number, bx: number, by: number, u: number, w: number): void {
    const U = CONFIG.ui;
    const x = Math.min(Math.max(bx + U.popupAhead * u, U.popupEdge * u), w - U.popupEdge * u);
    for (const p of this.pool) {
      if (p.age > U.popupLife) continue;
      p.age += dt;
      p.e.style.left = `${x}px`;
      p.e.style.top = `${by - p.lift * u}px`;
    }
  }

  showBanner(text: string, sub = ''): void {
    this.bannerMain.textContent = text;
    this.bannerSub.textContent = sub;
    this.banner.className = 'banner';
    void this.banner.offsetWidth;
    this.banner.className = 'banner show';
    clearTimeout(this.bannerTimer);
    this.bannerTimer = window.setTimeout(() => (this.banner.className = 'banner'), CONFIG.ui.bannerTime * 1000);
  }

  clear(): void {
    for (const p of this.pool) {
      p.e.className = 'popup';
      p.age = 1e9;
    }
    this.banner.className = 'banner';
  }
}
