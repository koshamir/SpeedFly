// One action: hold. held = active pointers > 0 || space held.
// Elements marked [data-ui] (buttons) never count as a press.

function isUi(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('[data-ui]') !== null;
}

export class Input {
  /** Fresh press (pointer or space) outside UI buttons. */
  onPress: ((kind: 'pointer' | 'key' | 'tilt') => void) | null = null;
  onKey: ((code: string) => void) | null = null;
  private readonly pointers = new Set<number>();
  private space = false;
  /** Tilt control (phones), counts as a held finger while pressed. */
  tilt: { enabled: boolean; pressed: boolean } | null = null;
  private tiltWas = false;

  constructor(private readonly root: HTMLElement) {
    root.addEventListener('pointerdown', this.down);
    root.addEventListener('pointerup', this.up);
    root.addEventListener('pointercancel', this.up);
    root.addEventListener('lostpointercapture', this.up);
    window.addEventListener('blur', this.reset);
    window.addEventListener('pagehide', this.reset);
    // fallbacks: a release outside the root (capture lost silently) still counts
    window.addEventListener('pointerup', this.up);
    window.addEventListener('pointercancel', this.up);
    window.addEventListener('touchend', (e) => e.touches.length === 0 && this.pointers.clear());
    window.addEventListener('touchcancel', (e) => e.touches.length === 0 && this.pointers.clear());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.reset();
    });
    window.addEventListener('keydown', this.keyDown);
    window.addEventListener('keyup', this.keyUp);
    const prevent = (e: Event): void => e.preventDefault();
    document.addEventListener('contextmenu', prevent);
    // no text selection, except in form fields (Tune / debug panels)
    document.addEventListener('selectstart', (e) => {
      if (!(e.target instanceof Element && e.target.closest('input, textarea'))) e.preventDefault();
    });
    document.addEventListener('dragstart', prevent);
    document.addEventListener('gesturestart', prevent);
    document.addEventListener('dblclick', prevent);
    // [data-scroll] panels (Tune drawer) keep native scrolling and slider drags
    const scrollable = (e: Event): boolean => e.target instanceof Element && e.target.closest('[data-scroll]') !== null;
    document.addEventListener('touchmove', (e) => scrollable(e) || e.preventDefault(), { passive: false });
  }

  get held(): boolean {
    const t = !!this.tilt?.enabled && this.tilt.pressed;
    if (t && !this.tiltWas && this.pointers.size === 0 && !this.space) this.onPress?.('tilt');
    this.tiltWas = t;
    return this.pointers.size > 0 || this.space || t;
  }

  readonly reset = (): void => {
    this.pointers.clear();
    this.space = false;
  };

  private readonly down = (e: PointerEvent): void => {
    if (isUi(e.target)) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    try {
      this.root.setPointerCapture(e.pointerId);
    } catch {
      // capture is best-effort (synthetic events)
    }
    const fresh = !this.held;
    this.pointers.add(e.pointerId);
    if (fresh) this.onPress?.('pointer');
  };

  private readonly up = (e: PointerEvent): void => {
    this.pointers.delete(e.pointerId);
  };

  private readonly keyDown = (e: KeyboardEvent): void => {
    if (e.code === 'Space') {
      e.preventDefault();
      if (e.repeat) return;
      const fresh = !this.held;
      this.space = true;
      if (fresh) this.onPress?.('key');
      return;
    }
    if (!e.repeat) this.onKey?.(e.code);
  };

  private readonly keyUp = (e: KeyboardEvent): void => {
    if (e.code === 'Space') this.space = false;
  };
}
