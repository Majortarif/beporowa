/**
 * Fixed-timestep simulation with interpolated rendering.
 * advance() is separated from requestAnimationFrame so it can be unit tested.
 */

export interface LoopCallbacks {
  /** Runs once per displayed frame, before simulation steps. */
  frameStart(frameDt: number): void;
  /** Runs zero or more times per frame with a constant dt. */
  fixedUpdate(fixedDt: number): void;
  /** alpha is how far we are between the last two simulation states. */
  render(alpha: number, frameDt: number): void;
}

export class FixedStepClock {
  private accumulator = 0;

  constructor(
    readonly fixedDt: number,
    private readonly maxSteps: number,
  ) {}

  /** Returns how many fixed steps to run for this frame. */
  advance(frameDt: number): number {
    this.accumulator += frameDt;
    let steps = 0;
    while (this.accumulator >= this.fixedDt && steps < this.maxSteps) {
      this.accumulator -= this.fixedDt;
      steps++;
    }
    // Drop the backlog after a stall instead of trying to catch up.
    if (steps === this.maxSteps && this.accumulator >= this.fixedDt) {
      this.accumulator = 0;
    }
    return steps;
  }

  get alpha(): number {
    return this.accumulator / this.fixedDt;
  }
}

export class GameLoop {
  private rafId = 0;
  private lastTime = 0;
  private running = false;
  private readonly clock: FixedStepClock;
  /** Slows the simulation for slow motion. Rendering keeps running at full rate. */
  timeScale = 1;

  constructor(
    private readonly callbacks: LoopCallbacks,
    fixedHz: number,
    maxSteps: number,
  ) {
    this.clock = new FixedStepClock(1 / fixedHz, maxSteps);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    this.rafId = requestAnimationFrame(this.tick);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.rafId);
  }

  private tick = (now: number): void => {
    if (!this.running) return;
    this.rafId = requestAnimationFrame(this.tick);
    // A hidden tab can return with a huge delta; never feed that to the sim.
    const frameDt = Math.min((now - this.lastTime) / 1000, 0.25);
    this.lastTime = now;

    this.callbacks.frameStart(frameDt);
    const steps = this.clock.advance(frameDt * this.timeScale);
    for (let i = 0; i < steps; i++) this.callbacks.fixedUpdate(this.clock.fixedDt);
    this.callbacks.render(this.clock.alpha, frameDt);
  };
}
