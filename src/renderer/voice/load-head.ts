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

/** Flatten every mesh in the file into one triangle soup in world space. */
function soup(scene: any): { positions: number[]; indices: number[] } {
  const positions: number[] = [];
  const indices: number[] = [];
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
    geo.dispose();
  });
  return { positions, indices };
}

/** Parse GLB bytes into the drawable model. */
export function parseHead(buf: ArrayBuffer): Promise<HeadModel> {
  return new Promise((resolve, reject) => {
    new GLTFLoader().parse(
      buf,
      "",
      (gltf: any) => {
        const { positions, indices } = soup(gltf.scene);
        if (!indices.length) {
          reject(new Error("the file has no triangles"));
          return;
        }
        resolve(buildModel(positions, indices));
      },
      reject,
    );
  });
}

/**
 * The head to draw: an uploaded one by name, else the built-in helmet.
 *
 * A name that no longer resolves falls back rather than throwing, so deleting
 * a file behind the app's back costs the head, not the whole wave.
 */
export async function loadHead(name?: string): Promise<HeadModel> {
  if (name) {
    const bytes = await window.jarvis.readHeadModel(name);
    if (bytes) return parseHead(bytes.buffer as ArrayBuffer);
    console.warn(`head model ${name} is gone; using the built-in one`);
  }
  const res = await fetch(HEAD_URL);
  if (!res.ok) throw new Error(`head model: ${res.status}`);
  return parseHead(await res.arrayBuffer());
}
