import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { buildModel, type HeadModel } from "./head-mesh";

/**
 * The GLB boundary, kept out of `head-mesh` so the geometry stays free of
 * three and testable on its own.
 *
 * The default head ships in `public/head/`, which the CSP's `default-src
 * 'self'` allows — the same reason `public/hands/` and `public/voice/` exist.
 * An uploaded head is read in main and parsed here, because GLTFLoader wants
 * a DOM.
 */
const HEAD_URL = "/head/head.glb";

/* eslint-disable @typescript-eslint/no-explicit-any */

export type MeshPart = { mesh: any; start: number; count: number };

/** Flatten every mesh in the file into one triangle soup in world space. */
function soup(scene: any): {
  positions: number[];
  indices: number[];
  parts: MeshPart[];
} {
  const positions: number[] = [];
  const indices: number[] = [];
  const parts: MeshPart[] = [];
  scene.updateMatrixWorld(true);
  scene.traverse((o: any) => {
    const geo = o.geometry?.attributes?.position
      ? o.geometry.clone().applyMatrix4(o.matrixWorld)
      : null;
    if (!geo) return;
    const p = geo.attributes.position.array as ArrayLike<number>;
    const base = positions.length / 3;
    for (let i = 0; i < p.length; i++) positions.push(p[i]);
    const ix = geo.index?.array as ArrayLike<number> | undefined;
    if (ix) for (let i = 0; i < ix.length; i++) indices.push(base + ix[i]);
    else for (let i = 0; i < p.length / 3; i++) indices.push(base + i);
    parts.push({ mesh: o, start: base, count: p.length / 3 });
    geo.dispose();
  });
  return { positions, indices, parts };
}

export type LoadedHead = {
  model: HeadModel;
  /** The GLTF scene itself. Colour mode renders it; the wireframe reads its
   *  deformed vertices out of it, so both modes need it kept. */
  scene: any;
  parts: MeshPart[];
};

/** Parse GLB bytes into the drawable model. */
export function parseHead(buf: ArrayBuffer): Promise<LoadedHead> {
  return new Promise((resolve, reject) => {
    new GLTFLoader().parse(
      buf,
      "",
      (gltf: any) => {
        const { positions, indices, parts } = soup(gltf.scene);
        if (!indices.length) {
          reject(new Error("the file has no triangles"));
          return;
        }
        resolve({
          model: buildModel(positions, indices),
          scene: gltf.scene,
          parts,
        });
      },
      reject,
    );
  });
}

/**
 * The head that is already in memory, by the name it was asked for. One entry:
 * a head is swapped rarely, and the reason this cache exists is the colour
 * switch, which asks for the same head it just had.
 *
 * The promise is cached rather than the result, so two callers in the same
 * frame share one parse instead of racing two.
 */
let cached: { name: string; head: Promise<LoadedHead> } | null = null;

/**
 * The head to draw: an uploaded one by name, else the built-in helmet.
 *
 * A name that no longer resolves falls back rather than throwing, so deleting
 * a file behind the app's back costs the head, not the whole wave.
 *
 * Cached because flipping the colour switch remounts the drawing effect, and
 * re-reading tens of megabytes over IPC and re-parsing its textures on the
 * window's own thread is a frozen app, not a slow one.
 */
export function loadHead(name?: string, fresh = false): Promise<LoadedHead> {
  const key = name ?? "";
  // `fresh` is not an opt-out of the cache for speed — it is the only safe way
  // for a second renderer to hold this head. `Object3D.add` unparents whatever
  // it is given, so two mounts of one cached scene fight over it: the second
  // steals the model and the first draws an empty group. A consumer that lives
  // alongside the wave asks for its own parse instead of sharing this one.
  if (fresh) return read(name);
  if (cached?.name === key) return cached.head;
  const head = read(name).catch((e) => {
    // a failed load must not be remembered as the answer for this name
    if (cached?.name === key) cached = null;
    throw e;
  });
  cached = { name: key, head };
  return head;
}

async function read(name?: string): Promise<LoadedHead> {
  if (name) {
    const bytes = await window.jarvis.readHeadModel(name);
    if (bytes) return parseHead(bytes.buffer as ArrayBuffer);
    console.warn(`head model ${name} is gone; using the built-in one`);
  }
  const res = await fetch(HEAD_URL);
  if (!res.ok) throw new Error(`head model: ${res.status}`);
  return parseHead(await res.arrayBuffer());
}
