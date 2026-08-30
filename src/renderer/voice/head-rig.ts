import type { MouthRegion } from "../../shared/types";
import {
  displaceRegion,
  recomputeNormals,
  regionMask,
  resetPose,
  type HeadModel,
} from "./head-mesh";

/**
 * Where a head's mouth comes from, and how to open it.
 *
 * Five tiers, checked in order: a mouth marked by hand, a morph target named
 * the way avatar exporters name them, a bone called something jaw-shaped, a
 * region found by face detection, then nothing. Everything downstream sees one
 * `apply(amount)` and never learns which tier answered.
 *
 * The scene is typed structurally so this module needs no three, which is what
 * keeps it unit-testable — a plain object stands in for an `Object3D`.
 */

export type RigObject = {
  name?: string;
  isBone?: boolean;
  isMesh?: boolean;
  children?: RigObject[];
  rotation?: { x: number };
  morphTargetDictionary?: Record<string, number>;
  morphTargetInfluences?: number[];
};

export type RigKind = "manual" | "morph" | "bone" | "detected" | "none";
export type Rig = { kind: RigKind; apply(amount: number): void };

// The names avatar exporters actually ship: ARKit, ReadyPlayerMe, Oculus
// visemes, VRM. Checked in this order, so a rig carrying several opens with the
// one that means "jaw down" rather than a vowel shape.
const MOUTH_MORPHS = ["jawOpen", "mouthOpen", "viseme_aa", "Fcl_MTH_A", "A"];

// Widest the jaw swings, in radians. Past this a rigged head gapes.
const JAW_MAX = 0.35;

function walk(
  root: RigObject,
  fn: (o: RigObject) => boolean,
): RigObject | null {
  if (fn(root)) return root;
  for (const child of root.children ?? []) {
    const found = walk(child, fn);
    if (found) return found;
  }
  return null;
}

function findMorph(root: RigObject): { mesh: RigObject; slot: number } | null {
  // The whole scene is searched before answering: stopping at the first mesh
  // carrying any of these names would rank by mesh order, so an early mesh's
  // vowel shape would beat a later mesh's jaw.
  let hit: { mesh: RigObject; slot: number; rank: number } | null = null;
  walk(root, (o) => {
    const dict = o.morphTargetDictionary;
    if (!dict || !o.morphTargetInfluences) return false;
    for (let rank = 0; rank < MOUTH_MORPHS.length; rank++) {
      const slot = dict[MOUTH_MORPHS[rank]];
      if (typeof slot !== "number") continue;
      if (!hit || rank < hit.rank) hit = { mesh: o, slot, rank };
      break;
    }
    return false;
  });
  return hit && { mesh: hit.mesh, slot: hit.slot };
}

function findJaw(root: RigObject): RigObject | null {
  return walk(root, (o) =>
    Boolean(o.isBone && o.rotation && /jaw/i.test(o.name ?? "")),
  );
}

function regionRig(kind: RigKind, model: HeadModel, region: MouthRegion): Rig {
  const mask = regionMask(model, region);
  let open = -1;
  return {
    kind,
    apply(amount) {
      if (amount === open) return;
      open = amount;
      if (amount <= 0) resetPose(model, mask);
      else displaceRegion(model, mask, amount, region.r);
      recomputeNormals(model, mask.faces);
    },
  };
}

/**
 * The mouth to drive, if there is one.
 *
 * `manual` outranks a real rig on purpose: marking a mouth costs opening a
 * panel, orbiting a head and clicking its face, so it is never accidental, and
 * a user who did it knows something a name match does not.
 */
export function resolveRig(
  root: RigObject,
  model: HeadModel,
  manual: MouthRegion | null,
  detected: MouthRegion | null,
): Rig {
  if (manual) return regionRig("manual", model, manual);

  const morph = findMorph(root);
  if (morph) {
    const { mesh, slot } = morph;
    return {
      kind: "morph",
      apply(amount) {
        mesh.morphTargetInfluences![slot] = amount;
      },
    };
  }

  const jaw = findJaw(root);
  if (jaw) {
    return {
      kind: "bone",
      apply(amount) {
        jaw.rotation!.x = amount * JAW_MAX;
      },
    };
  }

  if (detected) return regionRig("detected", model, detected);

  return {
    kind: "none",
    apply() {
      /* no-op when model has no mouth */
    },
  };
}
