import { CONFIG } from '../config';
import { load, save } from '../core/storage';
import type { Run } from '../sim/run';
import type { TerrainCursor } from '../world/terrain';
import { el } from './hud';

const FINGER =
  '<svg viewBox="0 0 60 80"><path d="M24 6c4 0 7 3 7 7v22l14 3c5 1 8 5 7 10l-3 18c-1 6-6 10-12 10H25c-4 0-7-2-9-5L6 54c-2-3-1-7 2-9 3-2 7-1 9 2l1 2V13c0-4 3-7 6-7z" fill="#fff" stroke="#241B3A" stroke-width="4" stroke-linejoin="round"/></svg>';

/**
 * Touch Teacher (§9): until the player lands 3 GREATs (localStorage flag) or leaves island 1.
 * Green HOLD on downslopes, amber LET GO on upslopes (rim tint in the hill shader + a label in the
 * thumb zone), a ghost finger that pulses just before a downslope. Never with the bot.
 */
export class Teacher {
  /** 0..1, drives the hill rim tint. */
  alpha = 0;
  private readonly root: HTMLDivElement;
  private readonly label: HTMLDivElement;
  private readonly finger: HTMLDivElement;
  private enabled: boolean;
  private advice = '';
  private shownAlpha = -1;
  private cls = '';

  constructor(parent: HTMLElement, bot: boolean) {
    this.enabled = !bot && load('taught') !== '1';
    this.root = el('div', 'teacher', parent);
    this.label = el('div', 'teach-label', this.root);
    // the whole micro-loop in one line (the label above says what to do right now)
    el('div', 'teach-sub', this.root, 'release on the uphill — fly — tap to land on a downhill');
    this.finger = el('div', 'teach-finger', this.root);
    this.finger.innerHTML = `<span class="teach-ring"></span>${FINGER}`;
  }

  update(dt: number, run: Run, cur: TerrainCursor, playing: boolean): void {
    const T = CONFIG.teacher, b = run.bird;
    if (this.enabled && (run.score.greats >= T.greats || run.island >= 2)) {
      this.enabled = false;
      save('taught', '1');
    }
    const target = this.enabled && playing ? 1 : 0;
    this.alpha += Math.sign(target - this.alpha) * Math.min(Math.abs(target - this.alpha), dt / T.fade);
    if (this.alpha > 0) {
      const x = (b.grounded ? b.u : b.x) + run.speed * T.lookAhead;
      const s = (cur.height(x + 2) - cur.height(x - 2)) / 4;
      if (s < -T.slope) this.advice = 'HOLD';
      else if (s > T.slope) this.advice = 'LET GO';
      const xf = x + run.speed * T.fingerAhead;
      const soon = this.advice !== 'HOLD' && (cur.height(xf + 2) - cur.height(xf - 2)) / 4 < -T.slope;
      const cls = this.advice === 'HOLD' ? 'hold' : soon ? 'soon' : this.advice ? 'let' : '';
      if (cls !== this.cls) {
        this.cls = cls;
        this.root.className = `teacher ${cls}`;
        this.label.textContent = this.advice;
      }
    }
    const a = Math.round(this.alpha * 50) / 50;
    if (a !== this.shownAlpha) {
      this.shownAlpha = a;
      this.root.style.opacity = String(a);
      this.root.style.display = a > 0 ? '' : 'none';
    }
  }
}
