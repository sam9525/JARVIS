// Pure clamp and decay for the palm-orbit flywheel: a roll throws the camera,
// it coasts, it stops (design §5). decaySpin takes the TOTAL seconds since the
// throw, not a per-frame delta, so the coast is wall-clock and a starved rAF
// loop cannot stretch it. Starting values, tune on a real camera.
export const SPIN_DECAY_PER_S = 3.0; // exponential decay rate of the coast
export const SPIN_PER_RAD_S = 10; // engine rad/s → OrbitControls autoRotateSpeed units
export const SPIN_MAX = 60; // autoRotateSpeed clamp
export const SPIN_REST = 0.05; // below this the flywheel is at rest

// Non-finite collapses to rest rather than propagating: the result is written
// straight to OrbitControls.autoRotateSpeed, where one NaN makes the camera
// position NaN permanently.
export function clampSpin(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(-SPIN_MAX, Math.min(SPIN_MAX, v));
}

export function decaySpin(v: number, dt: number): number {
  const next = v * Math.exp(-SPIN_DECAY_PER_S * dt);
  return Math.abs(next) < SPIN_REST ? 0 : next;
}
