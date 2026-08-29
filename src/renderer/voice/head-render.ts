import {
  AmbientLight,
  DirectionalLight,
  Group,
  PerspectiveCamera,
  Scene,
  WebGLRenderer,
} from "three";

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
