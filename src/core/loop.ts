// Fixed-timestep loop with render interpolation (TR-LOOP-01) and blur pause (TR-LOOP-03).

export interface LoopCallbacks {
  update(dt: number): void;
  render(alpha: number, frameDt: number): void;
}

export class FixedStepAccumulator {
  private acc = 0;
  constructor(public readonly step: number, private readonly maxSubSteps: number) {
    if (!(step > 0)) throw new Error('fixed step must be > 0');
  }

  /** Feed real elapsed seconds; returns how many fixed updates to run and the interpolation alpha. */
  advance(elapsed: number): { steps: number; alpha: number } {
    const safe = Number.isFinite(elapsed) && elapsed > 0 ? elapsed : 0;
    this.acc += Math.min(safe, this.step * this.maxSubSteps);
    let steps = 0;
    while (this.acc >= this.step && steps < this.maxSubSteps) {
      this.acc -= this.step;
      steps++;
    }
    if (steps === this.maxSubSteps && this.acc >= this.step) this.acc = 0; // drop backlog (spiral of death)
    return { steps, alpha: this.acc / this.step };
  }

  reset(): void {
    this.acc = 0;
  }
}

export class GameLoop {
  private readonly accumulator: FixedStepAccumulator;
  private last = 0;
  private rafId = 0;
  private paused = false;
  private running = false;
  /** Seconds spent inside the last update batch (debug panel). */
  lastUpdateMs = 0;
  lastRenderMs = 0;
  fps = 0;
  private fpsAcc = 0;
  private fpsFrames = 0;

  constructor(step: number, maxSubSteps: number, private readonly cb: LoopCallbacks) {
    this.accumulator = new FixedStepAccumulator(step, maxSubSteps);
    document.addEventListener('visibilitychange', () => this.setPaused(document.hidden));
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    const frame = (now: number): void => {
      this.rafId = requestAnimationFrame(frame);
      const elapsed = (now - this.last) / 1000;
      this.last = now;
      this.trackFps(elapsed);
      if (this.paused) {
        this.cb.render(0, 0);
        return;
      }
      const { steps, alpha } = this.accumulator.advance(elapsed);
      const t0 = performance.now();
      for (let i = 0; i < steps; i++) this.cb.update(this.accumulator.step);
      const t1 = performance.now();
      this.cb.render(alpha, elapsed);
      this.lastUpdateMs = t1 - t0;
      this.lastRenderMs = performance.now() - t1;
    };
    this.rafId = requestAnimationFrame(frame);
  }

  stop(): void {
    cancelAnimationFrame(this.rafId);
    this.running = false;
  }

  /** Pausing stops the clock so returning to the tab does not fast-forward the world. */
  setPaused(paused: boolean): void {
    this.paused = paused;
    this.last = performance.now();
    this.accumulator.reset();
  }

  isPaused(): boolean {
    return this.paused;
  }

  private trackFps(elapsed: number): void {
    this.fpsAcc += elapsed;
    this.fpsFrames++;
    if (this.fpsAcc >= 0.5) {
      this.fps = Math.round(this.fpsFrames / this.fpsAcc);
      this.fpsAcc = 0;
      this.fpsFrames = 0;
    }
  }
}
