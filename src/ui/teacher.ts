import { CONFIG } from '../config';
import type { LandKind } from '../core/events';
import { load, save } from '../core/storage';
import type { Run } from '../sim/run';
import type { TerrainCursor } from '../world/terrain';
import { el } from './hud';

const FINGER =
  '<svg viewBox="0 0 60 80"><path d="M24 6c4 0 7 3 7 7v22l14 3c5 1 8 5 7 10l-3 18c-1 6-6 10-12 10H25c-4 0-7-2-9-5L6 54c-2-3-1-7 2-9 3-2 7-1 9 2l1 2V13c0-4 3-7 6-7z" fill="#fff" stroke="#241B3A" stroke-width="4" stroke-linejoin="round"/></svg>';

/**
 * Touch Teacher (§9) with a smart mastery check. Three skills are measured while playing:
 *   hold     share of time the finger is DOWN on downslopes (ground)        EMA over ~holdTau s
 *   release  share of time the finger is UP on upslopes (ground)            EMA
 *   land     quality of judged landings (GREAT 1, GOOD 0.5, BAD 0)          EMA per landing
 * Each hint (rim tint + HOLD / LET GO label + ghost finger, and the "tap to land" line) fades out on its
 * own once its skill passes the threshold; when all three hold for masterTime s the teacher retires
 * for good (localStorage). Never with the bot.
 */
export class Teacher {
  /** 0..1, drives the hill rim tint. */
  alpha = 0;
  private readonly root: HTMLDivElement;
  private readonly label: HTMLDivElement;
  private readonly sub: HTMLDivElement;
  private readonly finger: HTMLDivElement;
  private enabled: boolean;
  private advice = '';
  private shownAlpha = -1;
  private cls = '';
  private hold = 0;
  private release = 0;
  private land = 0;
  private masterT = 0;
  private landings = 0;

  constructor(parent: HTMLElement, bot: boolean) {
    this.enabled = !bot && load('taught') !== '1';
    this.root = el('div', 'teacher', parent);
    this.label = el('div', 'teach-label', this.root);
    this.sub = el('div', 'teach-sub', this.root, 'in the air: hold to dive — touch down along a downhill');
    this.finger = el('div', 'teach-finger', this.root);
    this.finger.innerHTML = `<span class="teach-ring"></span>${FINGER}`;
  }

  /** Judged landing (from the bus). */
  landed(kind: LandKind): void {
    if (!this.enabled || kind === 'splash') return;
    const v = kind === 'great' ? 1 : kind === 'ok' ? 0.5 : 0;
    this.landings++;
    this.land += (v - this.land) * CONFIG.teacher.landK;
  }

  /** New run: skills keep their values (the player is the same). */
  update(dt: number, run: Run, cur: TerrainCursor, playing: boolean): void {
    const T = CONFIG.teacher, b = run.bird;
    if (this.enabled && playing && b.grounded) {
      cur.sample(b.u);
      const k = 1 - Math.exp(-dt / T.holdTau);
      if (cur.d1 < -T.slope) this.hold += ((run.held ? 1 : 0) - this.hold) * k;
      else if (cur.d1 > T.slope) this.release += ((run.held ? 0 : 1) - this.release) * k;
    }
    const holdOk = this.hold >= T.master, relOk = this.release >= T.master, landOk = this.land >= T.landMaster && this.landings >= 4;
    if (this.enabled && playing) {
      this.masterT = holdOk && relOk && landOk ? this.masterT + dt : 0;
      if (this.masterT >= T.masterTime) {
        this.enabled = false;
        save('taught', '1');
      }
    }
    const target = this.enabled && playing && !(holdOk && relOk) ? 1 : 0;
    this.alpha += Math.sign(target - this.alpha) * Math.min(Math.abs(target - this.alpha), dt / T.fade);
    if (this.alpha > 0) {
      const x = (b.grounded ? b.u : b.x) + run.speed * T.lookAhead;
      const s = (cur.height(x + 2) - cur.height(x - 2)) / 4;
      if (s < -T.slope) this.advice = holdOk ? '' : 'HOLD';
      else if (s > T.slope) this.advice = relOk ? '' : 'LET GO';
      const xf = x + run.speed * T.fingerAhead;
      const soon = !holdOk && this.advice !== 'HOLD' && (cur.height(xf + 2) - cur.height(xf - 2)) / 4 < -T.slope;
      const cls = this.advice === 'HOLD' ? 'hold' : soon ? 'soon' : this.advice ? 'let' : '';
      if (cls !== this.cls) {
        this.cls = cls;
        this.root.className = `teacher ${cls}`;
        this.label.textContent = this.advice;
      }
    }
    this.sub.style.visibility = this.enabled && !landOk && !b.grounded ? 'visible' : 'hidden';
    const a = Math.round(Math.max(this.alpha, this.enabled && playing && !landOk ? 1 : 0) * 50) / 50;
    if (a !== this.shownAlpha) {
      this.shownAlpha = a;
      this.root.style.opacity = String(a);
      this.root.style.display = a > 0 ? '' : 'none';
    }
  }
}
