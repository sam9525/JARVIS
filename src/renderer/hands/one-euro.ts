// Pure: 1-Euro filter + dead-zone, ported from gazeos/gaze/smoothing.py.
// Smooths the hand anchor so ring rotation does not jitter. t is seconds.

class LowPass {
  private prev: number | null = null;
  apply(x: number, alpha: number): number {
    this.prev = this.prev === null ? x : alpha * x + (1 - alpha) * this.prev;
    return this.prev;
  }
}

const alphaFor = (cutoff: number, dt: number) => {
  const tau = 1 / (2 * Math.PI * cutoff);
  return 1 / (1 + tau / dt);
};

export class OneEuroFilter {
  private x = new LowPass();
  private dx = new LowPass();
  private lastT: number | null = null;
  private lastX: number | null = null;

  constructor(
    private minCutoff = 1.0,
    private beta = 0.007,
    private dCutoff = 1.0,
  ) {}

  filter(x: number, t: number): number {
    const dt = this.lastT === null || t <= this.lastT ? 1 / 30 : t - this.lastT;
    this.lastT = t;
    const rawDx = this.lastX === null ? 0 : (x - this.lastX) / dt;
    const edx = this.dx.apply(rawDx, alphaFor(this.dCutoff, dt));
    const cutoff = this.minCutoff + this.beta * Math.abs(edx);
    const out = this.x.apply(x, alphaFor(cutoff, dt));
    this.lastX = x;
    return out;
  }
}

// 1D port of GazeSmoother. GazeControl's deadzone was 15 px of screen; hand
// coordinates are normalized 0..1 across the camera frame, so the unit
// changes — 0.008 of frame width is the starting value, tune on a real camera.
export class AnchorSmoother {
  private f = new OneEuroFilter();
  private lastOut: number | null = null;

  constructor(private deadzone = 0.008) {}

  update(x: number, t: number): number {
    const out = this.f.filter(x, t);
    if (this.lastOut !== null && Math.abs(out - this.lastOut) < this.deadzone)
      return this.lastOut;
    this.lastOut = out;
    return out;
  }
}
