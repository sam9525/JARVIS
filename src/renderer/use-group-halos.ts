import { useEffect } from "react";
import { Mesh, MeshBasicMaterial, Scene, SphereGeometry } from "three";
import type { GraphGroup } from "../shared/types";
import { groupOf } from "./domain-colors";

// huge-but-light halo: barely-there fill that reads as a soft glow region
const HALO = { opacity: 0.08, pad: 1.15, base: 10, intervalMs: 500 } as const;

export type HaloPoint = { x?: number; y?: number; z?: number };
export type HaloNode = HaloPoint & { id?: string | number };
export type HaloSceneHandle = { scene: () => Scene };

// centroid + bounding radius of a group's members, padded so the sphere
// visually contains them; undefined when the group matches nothing
export function fitHalo(
  points: HaloPoint[],
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
  return { x: cx, y: cy, z: cz, r: max * HALO.pad + HALO.base };
}

// one translucent sphere per group, re-fit to live node positions on an
// interval since the simulation keeps drifting
export function useGroupHalos(
  fgRef: React.MutableRefObject<HaloSceneHandle | undefined>,
  nodes: HaloNode[],
  groups: GraphGroup[],
): void {
  useEffect(() => {
    const scene = fgRef.current?.scene();
    if (!scene) return;
    const meshes = groups.map((g) => {
      const mesh = new Mesh(
        new SphereGeometry(1, 16, 16),
        new MeshBasicMaterial({
          color: g.color,
          transparent: true,
          opacity: HALO.opacity,
          depthWrite: false,
        }),
      );
      mesh.visible = false; // hidden until the first fit
      scene.add(mesh);
      return mesh;
    });
    // membership only changes with (nodes, groups) — this effect's deps —
    // so bucket once and let the interval track positions only
    const members = groups.map((g) =>
      nodes.filter((n) => groupOf(String(n.id), groups) === g),
    );
    const tick = setInterval(() => {
      meshes.forEach((mesh, i) => {
        const fit = fitHalo(members[i]);
        if (!fit) {
          mesh.visible = false;
          return;
        }
        mesh.visible = true;
        mesh.position.set(fit.x, fit.y, fit.z);
        mesh.scale.setScalar(fit.r);
      });
    }, HALO.intervalMs);
    return () => {
      clearInterval(tick);
      for (const m of meshes) {
        scene.remove(m);
        m.geometry.dispose();
        m.material.dispose();
      }
    };
  }, [fgRef, nodes, groups]);
}
