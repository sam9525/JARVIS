// Pure clamp and decay for the palm-orbit flywheel: a roll throws the
// camera, it coasts, it stops (design §5). Graph3D applies these per frame.
// Starting values, tune on a real camera.
export const SPIN_DECAY_PER_S = 2.2; // exponential decay rate of the coast
export const SPIN_PER_RAD_S = 10; // engine rad/s → OrbitControls autoRotateSpeed units
export const SPIN_MAX = 60; // autoRotateSpeed clamp
export const SPIN_REST = 0.05; // below this the flywheel is at rest

export function clampSpin(v: number): number {
  return Math.max(-SPIN_MAX, Math.min(SPIN_MAX, v));
}

export function decaySpin(v: number, dt: number): number {
  const next = v * Math.exp(-SPIN_DECAY_PER_S * dt);
  return Math.abs(next) < SPIN_REST ? 0 : next;
}
