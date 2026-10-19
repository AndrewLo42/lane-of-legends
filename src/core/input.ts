/**
 * MOBA-style keyboard + mouse state. Game code polls this each frame instead of reacting to events.
 * Right mouse = move (held keeps re-issuing), mouse position aims skillshots, wheel zooms.
 */
export class Input {
  private down = new Set<string>();
  private pressed = new Set<string>();
  /** Cursor in client pixels. */
  mouse = { x: innerWidth / 2, y: innerHeight / 2 };
  /** Right button held. */
  rmb = false;
  /** Right button went down since the last `endFrame` (spawns the click marker). */
  rmbClicked = false;
  /** Left button went down on the game view since the last `endFrame` (attack-move clicks). */
  lmbClicked = false;
  wheel = 0;
  /** Cursor is inside the window (edge-pan only while it is). */
  inside = true;
  /** Cursor is over a HUD element that takes its own clicks (the minimap): no edge-panning. */
  overUi = false;

  constructor(target: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space' || e.code === 'Tab') e.preventDefault();
      if (!this.down.has(e.code)) this.pressed.add(e.code);
      this.down.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.down.delete(e.code));
    window.addEventListener('blur', () => {
      this.down.clear();
      this.rmb = false;
    });

    target.addEventListener('contextmenu', (e) => e.preventDefault());
    target.addEventListener('mousedown', (e) => {
      this.mouse = { x: e.clientX, y: e.clientY };
      if (e.button === 2) {
        this.rmb = true;
        this.rmbClicked = true;
      }
      if (e.button === 0) this.lmbClicked = true;
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 2) this.rmb = false;
    });
    window.addEventListener('mousemove', (e) => {
      this.mouse = { x: e.clientX, y: e.clientY };
      this.inside = true;
    });
    document.addEventListener('mouseleave', () => (this.inside = false));
    target.addEventListener('wheel', (e) => (this.wheel += Math.sign(e.deltaY)), { passive: true });
  }

  isDown(code: string) {
    return this.down.has(code);
  }

  /** True only on the frame the key went down. */
  wasPressed(code: string) {
    return this.pressed.has(code);
  }

  endFrame() {
    this.pressed.clear();
    this.rmbClicked = false;
    this.lmbClicked = false;
    this.wheel = 0;
  }
}
