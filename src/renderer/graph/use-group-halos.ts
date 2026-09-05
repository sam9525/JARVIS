import { useEffect } from "react";
import { CanvasTexture, Scene, Sprite, SpriteMaterial } from "three";
import type { GraphGroup } from "../../shared/types";
import { groupOf } from "./domain-colors";

// huge-but-light halo: radial gradient that fades out like a CSS box shadow
const HALO = { pad: 1.1, base: 10, intervalMs: 200 } as const;

// opacity scales the halo down (default 1); the fleet turns it low to keep its
// one big backdrop halo faint
export type HaloFit = { pad: number; base: number; opacity?: number };

// center → edge alpha stops for the radial gradient (8-digit hex suffixes)
const HALO_STOPS: ReadonlyArray<readonly [number, string]> = [
  [0, "38"], // ~22% at the center
  [0.5, "14"], // ~8% mid-falloff
  [1, "00"], // transparent edge
];

export type HaloPoint = { x?: number; y?: number; z?: number };
export type HaloNode = HaloPoint & { id?: string | number };
export type HaloSceneHandle = { scene: () => Scene };

function makeHaloTexture(color: string): CanvasTexture {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
  const g = ctx.createRadialGradient(
    size / 2,
    size / 2,
    0,
    size / 2,
    size / 2,
    size / 2,
  );
  for (const [stop, alpha] of HALO_STOPS)
    g.addColorStop(stop, `${color}${alpha}`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return new CanvasTexture(canvas);
}

// centroid + bounding radius of a group's members, padded so the halo
// visually contains them; undefined when the group matches nothing
export function fitHalo(
  points: HaloPoint[],
  { pad, base }: HaloFit = HALO,
): { x: number; y: number; z: number; r: number } | undefined {
  if (points.length === 0) return undefined;
  let cx = 0;
  let cy = 0;
  let cz = 0;
  for (const p of points) {
    cx += p.x ?? 0;
    cy += p.y ?? 0;
    cz += p.z ?? 0;
  }
  cx /= points.length;
  cy /= points.length;
  cz /= points.length;
  let max = 0;
  for (const p of points) {
    const dx = (p.x ?? 0) - cx;
    const dy = (p.y ?? 0) - cy;
    const dz = (p.z ?? 0) - cz;
    max = Math.max(max, Math.sqrt(dx * dx + dy * dy + dz * dz));
  }
  return { x: cx, y: cy, z: cz, r: max * pad + base };
}

// one gradient billboard per group, re-fit to live node positions on an
// interval since the simulation keeps drifting
export function useGroupHalos(
  fgRef: React.MutableRefObject<HaloSceneHandle | undefined>,
  nodes: HaloNode[],
  groups: GraphGroup[],
  fit: HaloFit = HALO,
): void {
  useEffect(() => {
    const scene = fgRef.current?.scene();
    if (!scene) return;
    const sprites = groups.map((g) => {
      const sprite = new Sprite(
        new SpriteMaterial({
          map: makeHaloTexture(g.color),
          transparent: true,
          depthWrite: false,
          opacity: fit.opacity ?? 1,
        }),
      );
      sprite.visible = false; // hidden until the first fit
      scene.add(sprite);
      return sprite;
    });
    // membership only changes with (nodes, groups) — this effect's deps —
    // so bucket once and let the interval track positions only
    const members = groups.map((g) =>
      nodes.filter((n) => groupOf(String(n.id), groups) === g),
    );
    const tick = setInterval(() => {
      sprites.forEach((sprite, i) => {
        const f = fitHalo(members[i], fit);
        if (!f) {
          sprite.visible = false;
          return;
        }
        sprite.visible = true;
        sprite.position.set(f.x, f.y, f.z);
        sprite.scale.setScalar(f.r * 2); // sprite quad is 1×1 — r is a radius
      });
    }, HALO.intervalMs);
    return () => {
      clearInterval(tick);
      for (const s of sprites) {
        scene.remove(s);
        s.material.map?.dispose();
        s.material.dispose();
      }
    };
    // dep on the numbers, not the object — callers may pass a fresh literal
  }, [fgRef, nodes, groups, fit.pad, fit.base, fit.opacity]);
}
