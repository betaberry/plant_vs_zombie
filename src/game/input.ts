// Keyboard / mouse input with per-tick edge detection and Pointer Lock management (FR-MOV-01).

export class Input {
  private down = new Set<string>();
  private pressed = new Set<string>();
  private mouseDown = new Set<number>();
  private mousePressed = new Set<number>();
  private dx = 0;
  private dy = 0;
  private wheel = 0;
  /** Set by the UI: when false (menus / shop) game input is ignored. */
  gameplayEnabled = false;
  onLockChange: ((locked: boolean) => void) | null = null;
  onKeyAny: ((code: string) => void) | null = null;

  constructor(private readonly canvas: HTMLCanvasElement) {
    window.addEventListener('keydown', (e) => this.onKeyDown(e));
    window.addEventListener('keyup', (e) => this.down.delete(e.code));
    window.addEventListener('blur', () => this.releaseAll());
    canvas.addEventListener('mousedown', (e) => {
      if (!this.isLocked()) return;
      this.mouseDown.add(e.button);
      this.mousePressed.add(e.button);
    });
    window.addEventListener('mouseup', (e) => this.mouseDown.delete(e.button));
    window.addEventListener('mousemove', (e) => {
      if (!this.isLocked()) return;
      this.dx += e.movementX;
      this.dy += e.movementY;
    });
    window.addEventListener('wheel', (e) => {
      if (this.isLocked()) this.wheel += Math.sign(e.deltaY);
    }, { passive: true });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', () => {
      if (!this.isLocked()) this.releaseAll();
      this.onLockChange?.(this.isLocked());
    });
    document.addEventListener('pointerlockerror', () => console.warn('[input] Pointer Lock 请求被浏览器拒绝'));
  }

  private onKeyDown(e: KeyboardEvent): void {
    // Keep browser shortcuts out of the way of game keys while playing.
    if (this.gameplayEnabled && ['Tab', 'F3', 'F4', 'Space', 'ControlLeft', 'KeyB'].includes(e.code)) e.preventDefault();
    if (!e.repeat) {
      this.pressed.add(e.code);
      this.onKeyAny?.(e.code);
    }
    this.down.add(e.code);
  }

  private releaseAll(): void {
    this.down.clear();
    this.mouseDown.clear();
  }

  isLocked(): boolean {
    return document.pointerLockElement === this.canvas;
  }

  requestLock(): void {
    if (this.isLocked()) return;
    try {
      const res = this.canvas.requestPointerLock() as unknown;
      if (res instanceof Promise) res.catch((err: unknown) => console.warn('[input] Pointer Lock 失败:', err));
    } catch (err) {
      console.warn('[input] Pointer Lock 失败:', err);
    }
  }

  exitLock(): void {
    if (this.isLocked()) document.exitPointerLock();
  }

  isDown(code: string): boolean {
    return this.gameplayEnabled && this.down.has(code);
  }

  wasPressed(code: string): boolean {
    return this.gameplayEnabled && this.pressed.has(code);
  }

  isMouseDown(button: number): boolean {
    return this.gameplayEnabled && this.mouseDown.has(button);
  }

  wasMousePressed(button: number): boolean {
    return this.gameplayEnabled && this.mousePressed.has(button);
  }

  /** Mouse delta since the last call (pixels). */
  consumeMouse(): { dx: number; dy: number } {
    const out = { dx: this.dx, dy: this.dy };
    this.dx = 0;
    this.dy = 0;
    return this.gameplayEnabled ? out : { dx: 0, dy: 0 };
  }

  consumeWheel(): number {
    const w = this.wheel;
    this.wheel = 0;
    return this.gameplayEnabled ? w : 0;
  }

  /** Clears edge-triggered state; call at the end of every fixed update. */
  endTick(): void {
    this.pressed.clear();
    this.mousePressed.clear();
  }
}
