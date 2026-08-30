import {
  AmbientLight,
  PMREMGenerator,
  DirectionalLight,
  Group,
  PerspectiveCamera,
  Raycaster,
  Scene,
  Vector2,
  Vector3,
  WebGLRenderer,
  type Object3D,
} from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
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

/**
 * Turn the head to face a yaw/pitch aim.
 *
 * Pitch is negated: a positive pitch means "look up", and rotating about +x
 * brings the crown toward the camera, which reads as looking down. Every path
 * that poses the head goes through here — the renderer and the picker must
 * agree, or a marked mouth lands where the head is not.
 */
function aimAt(root: Object3D, yaw: number, pitch: number): void {
  root.rotation.y = yaw;
  root.rotation.x = -pitch;
}

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
  // No flip: buildModel negates y for the wireframe because a canvas counts y
  // downward, and the two cancel — so the file's own Y-up orientation is the
  // one both modes draw. Rolling this group π only stands the colour head on
  // its head beside an upright wireframe.
  root.add(model as never);
  scene.add(root);
  scene.add(new AmbientLight(0xffffff, 1.4));
  const key = new DirectionalLight(0xffffff, 1.8);
  key.position.set(1, 1, 2);
  scene.add(key);
  // A glTF material with a metallicRoughness texture and no metallicFactor is
  // fully metal, and metal has no diffuse colour: lit by lamps alone it renders
  // near black however bright they are, because it can only reflect. The room
  // is what it reflects — three's own procedural one, so no asset ships.
  const pmrem = new PMREMGenerator(renderer);
  const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = env;

  const camera = new PerspectiveCamera(30, w / h, 0.1, 100);
  camera.position.set(0, 0, DIST);

  return {
    render(yaw, pitch) {
      aimAt(root, yaw, pitch);
      renderer.render(scene, camera);
    },
    dispose() {
      env.dispose();
      pmrem.dispose();
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
      aimAt(root, angle.yaw, angle.pitch);
      root.updateMatrixWorld(true);
    }
    const hit = ray.intersectObject(loaded.scene as never, true)[0];
    if (!hit) return null;
    // The hit is in world space and the group carries the yaw/pitch.
    // `normalisePoint` wants the file's own glTF units, so the point goes back
    // through the group first — without this the pick lands wherever the head
    // happened to be turned.
    const local = root ? root.worldToLocal(hit.point.clone()) : hit.point;
    normalisePoint(loaded.model, local.x, local.y, local.z, out, 0);
    return [out[0], out[1], out[2]];
  };
}

/**
 * Project a model-space mouth region to canvas 2D coordinates.
 */
export function projectRegion(
  loaded: LoadedHead,
  w: number,
  h: number,
  angle: { yaw: number; pitch: number },
  region: import("../../shared/types").MouthRegion,
): { x: number; y: number; r: number; visible: boolean } | null {
  const root = (loaded.scene as { parent?: unknown }).parent as
    Object3D | undefined;
  if (!root) return null;
  aimAt(root, angle.yaw, angle.pitch);
  root.updateMatrixWorld(true);

  const camera = new PerspectiveCamera(30, w / h, 0.1, 100);
  camera.position.set(0, 0, DIST);
  camera.updateMatrixWorld(true);

  const { scale, cx, cy, cz } = loaded.model.norm;
  const [rcx, rcy, rcz] = region.c;
  const lx = rcx / scale + cx;
  const ly = -(rcy / scale + cy);
  const lz = rcz / scale + cz;

  const centerLocal = new Vector3(lx, ly, lz);
  const centerWorld = root.localToWorld(centerLocal);
  const centerProj = centerWorld.clone().project(camera);

  const rLocal = region.r / scale;
  const edgeLocal = new Vector3(lx + rLocal, ly, lz);
  const edgeWorld = root.localToWorld(edgeLocal);
  const edgeProj = edgeWorld.clone().project(camera);

  const x = ((centerProj.x + 1) / 2) * w;
  const y = ((-centerProj.y + 1) / 2) * h;
  const edgeX = ((edgeProj.x + 1) / 2) * w;
  const edgeY = ((-edgeProj.y + 1) / 2) * h;
  const r = Math.max(Math.hypot(edgeX - x, edgeY - y), 2);

  return {
    x,
    y,
    r,
    visible: centerProj.z < 1,
  };
}
