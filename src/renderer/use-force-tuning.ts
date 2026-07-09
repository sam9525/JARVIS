import { useEffect, useRef } from "react";
import { forceCollide, forceX, forceY, forceZ } from "d3-force-3d";
import type { Settings } from "../shared/types";

const COLLIDE_PADDING = 6; // min gap between any two nodes, linked or not

type LinkStrengthFn = (l: unknown) => number;
type LinkForce = {
  distance: (d: number) => LinkForce;
  strength: ((fn: LinkStrengthFn) => LinkForce) & (() => LinkStrengthFn);
};
type StrengthForce = { strength: (v: number) => StrengthForce };
type CollideNode = { r?: number };

// Structural view of a force-graph instance — satisfied by both
// react-force-graph-2d and -3d ForceGraphMethods.
export type ForceHandle = {
  d3Force: (name: string, force?: unknown) => unknown;
  d3ReheatSimulation: () => void;
};

export function useForceTuning(
  fgRef: React.MutableRefObject<ForceHandle | undefined>,
  forces: Settings["forces"],
): void {
  // d3's default link strength is per-link (1/min(degree)); capture it once so
  // the Link force slider multiplies it instead of flattening it to a constant.
  const baseLinkStrength = useRef<LinkStrengthFn | null>(null);
  // Reheat only re-settles after a live change. Skipping it on the first run
  // avoids flipping engineRunning=true before react-force-graph-3d's async
  // graphData flush has created the layout — otherwise its animation loop ticks
  // an undefined layout and throws "Cannot read properties of undefined
  // (reading 'tick')". 2D flushes synchronously so it never hit this.
  const didInit = useRef(false);

  useEffect(() => {
    const fg = fgRef.current;
    if (!fg) return;
    const charge = fg.d3Force("charge") as StrengthForce | undefined;
    const link = fg.d3Force("link") as LinkForce | undefined;
    const center = fg.d3Force("center") as StrengthForce | undefined;
    if (!charge || !link || !center) return;
    if (!baseLinkStrength.current) baseLinkStrength.current = link.strength();
    const base = baseLinkStrength.current;
    charge.strength(-forces.repelStrength);
    link
      .distance(forces.linkDistance)
      .strength((l) => base(l) * forces.linkStrength);
    center.strength(forces.centerStrength);
    fg.d3Force(
      "collide",
      forceCollide<CollideNode>((n) => (n.r ?? 4) + COLLIDE_PADDING),
    );
    // ponytail: gravity toward origin rounds the layout into a blob; scale with
    // centerStrength so the slider still controls compactness. forceZ is a no-op
    // in the 2D view (2D ignores z) so one hook serves both.
    const g = forces.centerStrength * 0.02;
    fg.d3Force("x", forceX(0).strength(g));
    fg.d3Force("y", forceY(0).strength(g));
    fg.d3Force("z", forceZ(0).strength(g));
    // skip on mount (see didInit note); reheat only for live slider re-settle
    if (didInit.current) fg.d3ReheatSimulation();
    else didInit.current = true;
  }, [forces]);
}
