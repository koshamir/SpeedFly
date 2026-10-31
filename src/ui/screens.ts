import { CONFIG } from '../config';
import { RECORD_NAMES, type Records } from '../core/records';
import type { Run } from '../sim/run';
import { el, fmt } from './hud';

const SLOPE_DOWN =
  '<svg viewBox="0 0 80 48"><path d="M2 8 C 30 8, 46 44, 78 44 L78 48 L2 48Z" fill="#4CC06B"/><path d="M2 8 C 30 8, 46 44, 78 44" fill="none" stroke="#E9FFB0" stroke-width="3"/><circle cx="34" cy="16" r="7" fill="#FFF7EA" stroke="#241B3A" stroke-width="2.5"/><path d="M42 26 l8 6" stroke="#fff" stroke-width="3" stroke-linecap="round"/></svg>';
const SLOPE_UP =
  '<svg viewBox="0 0 80 48"><path d="M2 44 C 34 44, 50 8, 78 8 L78 48 L2 48Z" fill="#F6C85F"/><path d="M2 44 C 34 44, 50 8, 78 8" fill="none" stroke="#FFF1D6" stroke-width="3"/><circle cx="50" cy="12" r="7" fill="#FFF7EA" stroke="#241B3A" stroke-width="2.5"/><path d="M58 6 l8 -5" stroke="#fff" stroke-width="3" stroke-linecap="round"/></svg>';

// Title / Pause / Results / rotate-your-phone overlays.
export class Screens {
  readonly title: HTMLDivElement;
  readonly pause: HTMLDivElement;
  readonly results: HTMLDivElement;
  readonly rotate: HTMLDivElement;
  readonly zzz: HTMLDivElement;
  readonly resume: HTMLButtonElement;
  readonly restart: HTMLButtonElement;
  readonly retry: HTMLButtonElement;
  readonly fullscreen: HTMLButtonElement;
  readonly help: HTMLButtonElement;
  readonly gear: HTMLButtonElement;
  readonly raceBtn: HTMLButtonElement;
  readonly pauseSettings: HTMLButtonElement;
  private readonly best: HTMLDivElement;
  private readonly rTitle: HTMLDivElement;
  private readonly rScore: HTMLDivElement;
  private readonly rBest: HTMLDivElement;
  private readonly rRows: HTMLDivElement;
  private readonly rRecords: HTMLDivElement;

  constructor(parent: HTMLElement) {
    this.title = el('div', 'screen title-screen', parent);
    const logo = el('div', 'logo', this.title);
    el('span', 'logo-a', logo, 'SUNSET');
    el('span', 'logo-b', logo, 'DASH');
    el('div', 'tagline', this.title, 'Speed and GREAT landings buy daylight — outrun the night!');
    const hints = el('div', 'hints', this.title);
    const h1 = el('div', 'hint', hints);
    h1.innerHTML = `${SLOPE_DOWN}<b>Downhill</b><span>HOLD</span>`;
    const h2 = el('div', 'hint', hints);
    h2.innerHTML = `${SLOPE_UP}<b>Uphill</b><span>LET GO</span>`;
    el('div', 'tap', this.title, 'Tap to start');
    this.raceBtn = el('button', 'btn btn-alt btn-race', this.title, '🏁 RACE');
    this.help = el('button', 'btn-round btn-help', this.title, '?');
    this.gear = el('button', 'btn-round btn-gear', this.title, '⚙');
    this.best = el('div', 'best', this.title);
    this.zzz = el('div', 'zzz', parent);
    this.zzz.innerHTML = '<span>z</span><span>Z</span><span>z</span>';

    this.pause = el('div', 'screen pause-screen', parent);
    el('div', 'big-label', this.pause, 'PAUSED');
    this.resume = el('button', 'btn btn-main', this.pause, 'Resume');
    this.restart = el('button', 'btn btn-alt', this.pause, 'Restart');
    this.fullscreen = el('button', 'btn btn-alt btn-fs', this.pause, 'Fullscreen');
    this.pauseSettings = el('button', 'btn btn-alt', this.pause, 'Settings');
    const fsDoc = document as Document & { webkitFullscreenEnabled?: boolean };
    if (!(document.fullscreenEnabled || fsDoc.webkitFullscreenEnabled)) this.fullscreen.style.display = 'none';

    this.results = el('div', 'screen results-screen', parent);
    const panel = el('div', 'panel', this.results);
    this.rTitle = el('div', 'r-title', panel, 'Night fell');
    this.rScore = el('div', 'r-score', panel);
    this.rBest = el('div', 'r-best', panel);
    this.rRecords = el('div', 'r-records', panel);
    this.rRows = el('div', 'r-rows', panel);
    this.retry = el('button', 'btn btn-main', panel, 'ONE MORE RUN');

    this.rotate = el('div', 'screen rotate-screen', parent);
    el('div', 'rotate-icon', this.rotate);
    el('div', 'big-label', this.rotate, 'Rotate your phone');

    for (const b of [this.resume, this.restart, this.retry, this.fullscreen, this.help, this.gear, this.pauseSettings, this.raceBtn]) b.setAttribute('data-ui', '');
    this.showOnly(null);
  }

  showOnly(s: HTMLDivElement | null): void {
    for (const x of [this.title, this.pause, this.results]) x.classList.toggle('visible', x === s);
    this.zzz.classList.toggle('visible', s === this.title || s === this.results);
  }

  setBest(best: number): void {
    this.best.textContent = best > 0 ? `Best ${fmt(best)}` : '';
  }

  setRotate(on: boolean): void {
    this.rotate.classList.toggle('visible', on);
  }

  setRetryLocked(locked: boolean): void {
    this.retry.classList.toggle('locked', locked);
  }

  fillResults(run: Run, best: number, newBest: boolean, broken: (keyof Records)[] = []): void {
    const s = run.score;
    this.rRecords.textContent = broken.length ? `NEW RECORD: ${broken.map((k) => RECORD_NAMES[k]).join(' · ')}` : '';
    this.rTitle.textContent = 'Night fell';
    this.rScore.textContent = fmt(s.total);
    this.rBest.textContent = newBest ? 'NEW BEST!' : `Best ${fmt(best)}`;
    this.rBest.classList.toggle('new', newBest);
    const rows: [string, string][] = [
      ['Distance', `${fmt(s.meters)} m`],
      ['GREAT landings', String(s.greats)],
      ['Longest GREAT chain', String(s.maxStreak)],
      ['Time survived', `${Math.floor(run.t / 60)}:${String(Math.floor(run.t % 60)).padStart(2, '0')}`],
      ['Fever time', `${s.feverTime.toFixed(1)} s`],
      ['Sky touches', String(s.skyTouches)],
      ['Coins', String(s.coins + s.blueCoins)],
      ['Islands', String(s.islands)],
      ['Max speed', `${Math.round(s.maxSpeed * CONFIG.speed.kmhPerPx)} km/h`],
    ];
    this.rRows.innerHTML = rows.map(([k, v]) => `<div class="r-row"><span>${k}</span><b>${v}</b></div>`).join('');
  }
}
