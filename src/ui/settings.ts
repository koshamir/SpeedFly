import { CONFIG } from '../config';
import { load, save } from '../core/storage';
import { Tilt } from '../core/tilt';
import { el } from './hud';

// Settings (title + pause): Control Touch / Tilt (phones only), tilt sensitivity, calibrate, sound.
// Saved locally. The whole overlay is [data-ui]: taps on it never press.
export class Settings {
  readonly root: HTMLDivElement;
  private readonly touchBtn: HTMLButtonElement;
  private readonly tiltBtn: HTMLButtonElement;
  private readonly sens: HTMLInputElement;
  private readonly sensVal: HTMLSpanElement;
  private readonly soundBtn: HTMLButtonElement;
  private readonly msg: HTMLDivElement;
  private readonly tiltRows: HTMLDivElement;
  onClose: (() => void) | null = null;

  constructor(
    parent: HTMLElement,
    private readonly tilt: Tilt,
    private readonly sound: { muted: boolean; toggle(): void },
  ) {
    this.root = el('div', 'screen settings', parent);
    this.root.setAttribute('data-ui', '');
    const panel = el('div', 'panel', this.root);
    el('div', 'r-title', panel, 'Settings');
    const ctl = el('div', 'set-row', panel);
    el('span', 'set-label', ctl, 'Control');
    this.touchBtn = el('button', 'btn-chip', ctl, 'Touch');
    this.tiltBtn = el('button', 'btn-chip', ctl, 'Tilt');
    this.tiltRows = el('div', 'set-tilt', panel);
    el('div', 'set-hint', this.tiltRows, 'Tilt the phone RIGHT = hold · back to neutral = release');
    const sr = el('div', 'set-row', this.tiltRows);
    el('span', 'set-label', sr, 'Sensitivity');
    this.sens = el('input', '', sr);
    this.sens.type = 'range';
    this.sens.min = '6';
    this.sens.max = '30';
    this.sens.step = '1';
    this.sensVal = el('span', 'set-val', sr);
    const cal = el('button', 'btn btn-alt', this.tiltRows, 'Calibrate (hold the phone as you play)');
    const snd = el('div', 'set-row', panel);
    el('span', 'set-label', snd, 'Sound');
    this.soundBtn = el('button', 'btn-chip', snd);
    this.msg = el('div', 'set-hint set-msg', panel);
    const close = el('button', 'btn btn-main', panel, 'Done');
    if (!Tilt.available()) {
      ctl.style.display = 'none';
      this.tiltRows.style.display = 'none';
    }
    const thr = Number(load('tiltThr'));
    if (thr >= 6 && thr <= 30) CONFIG.tilt.threshold = thr;
    this.sens.addEventListener('input', () => {
      CONFIG.tilt.threshold = 36 - Number(this.sens.value); // right = more sensitive (smaller angle)
      save('tiltThr', String(CONFIG.tilt.threshold));
      this.sync();
    });
    this.touchBtn.addEventListener('click', () => {
      this.tilt.disable();
      save('control', 'touch');
      this.say('');
      this.sync();
    });
    this.tiltBtn.addEventListener('click', () => void this.enableTilt());
    cal.addEventListener('click', () => {
      this.tilt.calibrate();
      this.say('Neutral angle saved');
    });
    this.soundBtn.addEventListener('click', () => {
      this.sound.toggle();
      this.sync();
    });
    close.addEventListener('click', () => {
      this.show(false);
      this.onClose?.();
    });
    this.sync();
  }

  /** On a tap (iOS permission needs one). */
  async enableTilt(): Promise<void> {
    this.say('…');
    const err = await this.tilt.enable();
    save('control', err ? 'touch' : 'tilt');
    this.say(err || 'Tilt on — the current angle is neutral');
    this.sync();
  }

  show(on: boolean): void {
    this.root.classList.toggle('visible', on);
    if (on) this.sync();
  }

  get open(): boolean {
    return this.root.classList.contains('visible');
  }

  private say(s: string): void {
    this.msg.textContent = s;
  }

  private sync(): void {
    this.touchBtn.classList.toggle('on', !this.tilt.enabled);
    this.tiltBtn.classList.toggle('on', this.tilt.enabled);
    this.tiltRows.classList.toggle('off', !this.tilt.enabled);
    this.sens.value = String(36 - CONFIG.tilt.threshold);
    this.sensVal.textContent = `${CONFIG.tilt.threshold}°`;
    this.soundBtn.textContent = this.sound.muted ? 'Off' : 'On';
    this.soundBtn.classList.toggle('on', !this.sound.muted);
  }
}
