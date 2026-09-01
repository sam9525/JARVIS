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
import { denormalisePoint, normalisePoint } from "./head-mesh";
import type { LoadedHead } from "./load-head";

/**
 * The head rendered as the model's own materials, for the colour mode.
 *
 * A second WebGL context beside `Graph3D`. Browsers allow around sixteen, so
 * this is safe, but `dispose` must actually run on unmount or a few mode flips
 * leak them — which is why the whole thing is one object with one teardown.
 *
 * The canvas belongs to this object, not to the caller: `forceContextLoss`
 * leaves a canvas that can never grant a working context again, so a node the
 * caller keeps across two mounts kills the second renderer inside three, where
 * it reads `precision` off a null format. It takes a host element and puts its
 * own canvas inside.
 */
export type ColourHead = {
  /** The canvas this head draws into. It belongs to the object, so whatever
   *  needs the picture reads it from here rather than holding a node of its
   *  own — which is the whole point of the host/canvas split. */
  canvas: HTMLCanvasElement;
  render(yaw: number, pitch: number): void;
  dispose(): void;
};

// Matches head-mesh's own DIST, so the colour head sits the same distance away
// as the wireframe and the two modes frame the model identically.
const DIST = 4;

// `projectRegion` runs per invalidated frame and again on every pointer press,
// so its camera and its denormalise scratch are hoisted rather than rebuilt.
let flat: PerspectiveCamera | null = null;
const pt = new Float32Array(3);

function flatCamera(w: number, h: number): PerspectiveCamera {
  if (!flat) {
    flat = new PerspectiveCamera(30, w / h, 0.1, 100);
    flat.position.set(0, 0, DIST);
  } else if (flat.aspect !== w / h) {
    flat.aspect = w / h;
    flat.updateProjectionMatrix();
  }
  // Same reason as `pickOnScene`: the projection reads `matrixWorld`, which
  // `position` alone never refreshes.
  flat.updateMatrixWorld(true);
  return flat;
}

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
  host: HTMLElement,
  model: unknown,
  w: number,
  h: number,
): ColourHead {
  const canvas = document.createElement("canvas");
  // A canvas is inline by default, which leaves descender space under it and
  // pushes the head down inside a host box of exactly its own height.
  canvas.style.display = "block";
  host.appendChild(canvas);
  let renderer: WebGLRenderer;
  try {
    renderer = new WebGLRenderer({ canvas, alpha: true, antialias: true });
  } catch (e) {
    // Three's own failure here reads as a null property deep inside its
    // capabilities check, which tells a person nothing about their head.
    canvas.remove();
    throw new Error(
      `the head could not open a WebGL view — ${
        e instanceof Error ? e.message : String(e)
      }`,
    );
  }
  renderer.setPixelRatio(window.devicePixelRatio || 1);
  renderer.setSize(w, h);

  const scene = new Scene();
  const root = new Group();
  // No flip: buildModel negates y for the wireframe because a canvas counts y
  // downward, and the two cancel — so the file's own Y-up orientation is the
  // one both modes draw. Rolling this group π only stands the colour head on
  // its head beside an upright wireframe.
  //
  // `add` unparents the model, so the parent it had is put back on dispose:
  // a short-lived mount (the detection shot) must hand the head back rather
  // than leave it hanging off a group nobody renders any more.
  const head = model as Object3D;
  const wasParentedTo = head.parent;
  root.add(head);
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
  const room = new RoomEnvironment();
  const env = pmrem.fromScene(room, 0.04).texture;
  scene.environment = env;

  const camera = new PerspectiveCamera(30, w / h, 0.1, 100);
  camera.position.set(0, 0, DIST);

  return {
    canvas,
    render(yaw, pitch) {
      aimAt(root, yaw, pitch);
      renderer.render(scene, camera);
    },
    dispose() {
      root.remove(head);
      wasParentedTo?.add(head);
      env.dispose();
      room.dispose();
      pmrem.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
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
  // `setFromCamera` reads the ray origin off `matrixWorld`, which `position`
  // alone does not touch: without this the ray starts at the world origin,
  // inside the head, and every pick lands on the far side of it.
  camera.updateMatrixWorld(true);
  return (x: number, y: number): [number, number, number] | null => {
    // the scene rotates under a fixed camera, so the same angles the renderer
    // draws with have to be on the object before the ray is cast. An unmounted
    // scene carries no angle at all: a ray cast at it would hit an unturned
    // head and answer confidently with the wrong point, so it answers nothing.
    const root = (loaded.scene as { parent?: unknown }).parent as
      Object3D | undefined;
    if (!root) return null;
    at.set((x / w) * 2 - 1, -((y / h) * 2 - 1));
    ray.setFromCamera(at, camera);
    aimAt(root, angle.yaw, angle.pitch);
    root.updateMatrixWorld(true);
    const hit = ray.intersectObject(loaded.scene as never, true)[0];
    if (!hit) return null;
    // The hit is in world space and the group carries the yaw/pitch.
    // `normalisePoint` wants the file's own glTF units, so the point goes back
    // through the group first — without this the pick lands wherever the head
    // happened to be turned.
    const local = root.worldToLocal(hit.point.clone());
    normalisePoint(loaded.model, local.x, local.y, local.z, out, 0);
    return [out[0], out[1], out[2]];
  };
}

/**
 * Project a model-space mouth region to a canvas rectangle: centre, and half a
 * width and height in pixels.
 */
export function projectRegion(
  loaded: LoadedHead,
  w: number,
  h: number,
  angle: { yaw: number; pitch: number },
  region: import("../../shared/types").MouthRegion,
): { x: number; y: number; w: number; h: number; visible: boolean } | null {
  const root = (loaded.scene as { parent?: unknown }).parent as
    Object3D | undefined;
  if (!root) return null;
  aimAt(root, angle.yaw, angle.pitch);
  root.updateMatrixWorld(true);

  const camera = flatCamera(w, h);

  denormalisePoint(loaded.model, ...region.c, pt);
  const centerLocal = new Vector3(pt[0], pt[1], pt[2]);
  const centerWorld = root.localToWorld(centerLocal);
  const centerProj = centerWorld.clone().project(camera);

  const x = ((centerProj.x + 1) / 2) * w;
  const y = ((-centerProj.y + 1) / 2) * h;

  // Each half-extent is projected as its own edge point, so a region seen at an
  // angle narrows the way the face it sits on does.
  const extent = (dx: number, dy: number) => {
    denormalisePoint(
      loaded.model,
      region.c[0] + dx,
      region.c[1] + dy,
      region.c[2],
      pt,
    );
    const p = root
      .localToWorld(new Vector3(pt[0], pt[1], pt[2]))
      .project(camera);
    return Math.max(
      Math.hypot(((p.x + 1) / 2) * w - x, ((-p.y + 1) / 2) * h - y),
      2,
    );
  };

  // Front or back, not near or far: the camera looks down -z at a head centred
  // on the model's own middle, so a region whose outward direction still points
  // at the camera is the one facing it. Testing the far plane instead drew the
  // marker straight through the back of the skull.
  denormalisePoint(loaded.model, 0, 0, 0, pt);
  const originWorld = root.localToWorld(new Vector3(pt[0], pt[1], pt[2]));
  const outward = centerWorld.clone().sub(originWorld);

  return {
    x,
    y,
    w: extent(region.w, 0),
    h: extent(0, region.h),
    visible: outward.z > 0,
  };
}
