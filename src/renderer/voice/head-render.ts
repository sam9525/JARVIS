import {
  AmbientLight,
  DirectionalLight,
  Group,
  PerspectiveCamera,
  Raycaster,
  Scene,
  Vector2,
  WebGLRenderer,
  type Object3D,
} from "three";
import { normalisePoint } from "./head-mesh";
import type { LoadedHead } from "./load-head";

/**
 * The head rendered as the model's own materials, for the colour mode.
 *
 * A second WebGL context beside `Graph3D`. Browsers allow around sixteen, so
 * this is safe, but `dispose` must actually run on unmount or a few mode flips
 * leak them — which is why the whole thing is one object with one teardown.
 */
export type ColourHead = {
  render(yaw: number, pitch: number): void;
  dispose(): void;
};

// Matches head-mesh's own DIST, so the colour head sits the same distance away
// as the wireframe and the two modes frame the model identically.
const DIST = 4;

export function mountColourHead(
  canvas: HTMLCanvasElement,
  model: unknown,
  w: number,
  h: number,
): ColourHead {
  const renderer = new WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio || 1);
  renderer.setSize(w, h, false);

  const scene = new Scene();
  const root = new Group();
  // glTF is Y-up and the app's head space is Y-down, the same flip buildModel
  // applies to the soup — without it the colour head hangs upside down beside
  // an identical wireframe.
  root.rotation.z = Math.PI;
  root.add(model as never);
  scene.add(root);
  scene.add(new AmbientLight(0xffffff, 1.4));
  const key = new DirectionalLight(0xffffff, 1.8);
  key.position.set(1, 1, 2);
  scene.add(key);

  const camera = new PerspectiveCamera(30, w / h, 0.1, 100);
  camera.position.set(0, 0, DIST);

  return {
    render(yaw, pitch) {
      root.rotation.y = yaw;
      root.rotation.x = pitch;
      renderer.render(scene, camera);
    },
    dispose() {
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}

/**
 * Canvas pixels to a point on the head, in normalised model space, or `null`.
 *
 * `null` is a real answer: a click past the silhouette hit nothing, and the
 * picker must not fall back to a nearest vertex, which would mark the far side
 * of the head.
 */
export function pickOnScene(
  loaded: LoadedHead,
  w: number,
  h: number,
  angle: { yaw: number; pitch: number },
) {
  const ray = new Raycaster();
  const at = new Vector2();
  const out = new Float32Array(3);
  const camera = new PerspectiveCamera(30, w / h, 0.1, 100);
  camera.position.set(0, 0, DIST);
  return (x: number, y: number): [number, number, number] | null => {
    at.set((x / w) * 2 - 1, -((y / h) * 2 - 1));
    ray.setFromCamera(at, camera);
    // the scene rotates under a fixed camera, so the same angles the renderer
    // draws with have to be on the object before the ray is cast
    const root = (loaded.scene as { parent?: unknown }).parent as
      Object3D | undefined;
    if (root) {
      root.rotation.y = angle.yaw;
      root.rotation.x = angle.pitch;
      root.updateMatrixWorld(true);
    }
    const hit = ray.intersectObject(loaded.scene as never, true)[0];
    if (!hit) return null;
    // The hit is in world space, and the group carries both the yaw/pitch and
    // the Y-flip that mountColourHead applies. `normalisePoint` wants the
    // file's own glTF units, so the point goes back through the group first —
    // without this the pick lands mirrored in x and y.
    const local = root ? root.worldToLocal(hit.point.clone()) : hit.point;
    normalisePoint(loaded.model, local.x, local.y, local.z, out, 0);
    return [out[0], out[1], out[2]];
  };
}
