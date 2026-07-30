// All the ring's trigonometry, with no DOM and no React — Ring.tsx maps this
// straight onto CSS transforms. rotation is in degrees.

export type RingTile = {
  angle: number; // [-180, 180); 0 = front centre
  x: number; // -1..1 horizontal position (sin of angle)
  y: number; // -1..1 vertical position; 1 = front/bottom (cos of angle)
  depth: number; // 0 back … 1 front — drives scale/opacity/z-index
  centered: boolean;
};

export type RingLayout = {
  tiles: RingTile[];
  centeredIndex: number; // -1 when the ring is empty
};

const mod = (v: number, n: number) => ((v % n) + n) % n;

// normalize an angle to [-180, 180)
const wrap = (deg: number) => mod(deg + 180, 360) - 180;

export function ringLayout(count: number, rotation: number): RingLayout {
  if (count === 0) return { tiles: [], centeredIndex: -1 };
  const step = 360 / count;
  const centeredIndex = mod(Math.round(rotation / step), count);
  const tiles = Array.from({ length: count }, (_, i) => {
    const angle = wrap(i * step - rotation);
    const rad = (angle * Math.PI) / 180;
    return {
      angle,
      x: Math.sin(rad),
      y: Math.cos(rad),
      depth: (Math.cos(rad) + 1) / 2,
      centered: i === centeredIndex,
    };
  });
  return { tiles, centeredIndex };
}

/** nearest resting rotation — a released drag animates to this */
export function snapRotation(rotation: number, count: number): number {
  if (count === 0) return rotation;
  const step = 360 / count;
  return Math.round(rotation / step) * step;
}

/** the rotation that brings tile `index` to centre by the shortest path */
export function rotationTo(
  index: number,
  rotation: number,
  count: number,
): number {
  if (count === 0) return rotation;
  const step = 360 / count;
  return rotation + wrap(index * step - rotation);
}
