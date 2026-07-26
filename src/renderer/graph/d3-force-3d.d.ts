// d3-force-3d ships no types; declare only what we use
declare module "d3-force-3d" {
  export function forceCollide<N>(
    radius?: number | ((node: N) => number),
  ): (alpha: number) => void;

  type PositionForce = ((alpha: number) => void) & {
    strength(s: number): PositionForce;
  };
  export function forceX(x?: number): PositionForce;
  export function forceY(y?: number): PositionForce;
}
