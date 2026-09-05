import type { MouthRegion } from "../../shared/types";
import {
  displaceRegion,
  recomputeNormals,
  regionMask,
  resetPose,
  type HeadModel,
  type RegionMask,
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
export type Rig = {
  kind: RigKind;
  /**
   * Open the mouth, and say whether anything moved — a caller that copies the
   * pose somewhere else has nothing to copy when it did not.
   *
   * `normals` is what the wireframe needs and the colour renderer does not: it
   * draws the file's own geometry, whose normals live on the GPU, so rebuilding
   * the CPU model's is work nothing reads.
   */
  apply(amount: number, normals?: boolean): boolean;
  /** The vertices a region tier moves, for a renderer that draws the file's
   *  own geometry rather than the CPU model — it has to copy the displacement
   *  across, and only these vertices ever change. Absent on the GPU tiers,
   *  which deform the geometry themselves. */
  mask?: RegionMask;
};

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
  // read back through its own type: `hit` is only ever written inside the walk
  // callback, which control-flow analysis cannot see, so it still reads as null
  const found = hit as { mesh: RigObject; slot: number } | null;
  return found && { mesh: found.mesh, slot: found.slot };
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
    mask,
    apply(amount, normals = true) {
      if (amount === open) return false;
      open = amount;
      if (amount <= 0) resetPose(model, mask);
      else displaceRegion(model, mask, amount, region.h);
      // ponytail: colour mode leaves the GPU normals at rest, so an open mouth
      // is lit as if shut. Write the mask's face normals across in
      // `writeBackPose` if that flat lip ever reads wrong at 240×200.
      if (normals) recomputeNormals(model, mask.faces);
      return true;
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
        if (mesh.morphTargetInfluences![slot] === amount) return false;
        mesh.morphTargetInfluences![slot] = amount;
        return true;
      },
    };
  }

  const jaw = findJaw(root);
  if (jaw) {
    return {
      kind: "bone",
      apply(amount) {
        const next = amount * JAW_MAX;
        if (jaw.rotation!.x === next) return false;
        jaw.rotation!.x = next;
        return true;
      },
    };
  }

  if (detected) return regionRig("detected", model, detected);

  return {
    kind: "none",
    apply() {
      return false; // no mouth to move
    },
  };
}
