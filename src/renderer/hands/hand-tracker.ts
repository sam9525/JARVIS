// Effectful boundary: webcam + MediaPipe HandLandmarker (WASM) → landmark
// frames. Deliberately not unit tested, matching the PTY and CLI boundaries.
import { FilesetResolver, HandLandmarker } from "@mediapipe/tasks-vision";
import type { Landmark } from "./pinch";

// t in seconds. `second` is the other hand when one is in frame — only the
// two-palm zoom reads it; every other gesture is one-handed.
export type HandFrame = {
  hand: Landmark[] | null;
  second: Landmark[] | null;
  t: number;
};

// Local assets (Task 2): the CSP's default-src 'self' forbids the CDN fetch
// every MediaPipe example uses, so wasm + model ship in public/hands/.
const WASM_DIR = "/hands/wasm";
const MODEL_URL = "/hands/hand_landmarker.task";

export async function startHandTracker(
  onFrame: (f: HandFrame) => void,
): Promise<() => void> {
  if (!navigator.mediaDevices?.getUserMedia)
    throw new Error("No camera available");

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 640, height: 480 },
    });
  } catch {
    throw new Error("Camera permission denied");
  }

  let landmarker: HandLandmarker;
  try {
    const fileset = await FilesetResolver.forVisionTasks(WASM_DIR);
    landmarker = await HandLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL_URL, delegate: "GPU" },
      runningMode: "VIDEO",
      numHands: 2, // the zoom needs both palms; the rest use landmarks[0]
    });
  } catch {
    stream.getTracks().forEach((track) => track.stop());
    throw new Error("Hand tracker failed to load");
  }

  const video = document.createElement("video");
  video.srcObject = stream;
  video.muted = true;
  try {
    await video.play();
  } catch {
    // nothing has been returned yet, so a throw here would strand a live
    // camera with no stop handle — tear down before rethrowing
    landmarker.close();
    stream.getTracks().forEach((track) => track.stop());
    throw new Error("Camera failed to start");
  }

  let raf = 0;
  let lastVideoT = -1;
  const loop = () => {
    raf = requestAnimationFrame(loop);
    if (video.currentTime === lastVideoT) return; // no new camera frame yet
    lastVideoT = video.currentTime;
    const result = landmarker.detectForVideo(video, performance.now());
    // mirror x so moving the hand right reads as pointer-right — the same sign
    // a mouse drag produces. z is passed through untouched and unused.
    const mirror = (lm: Landmark[] | undefined) =>
      lm ? lm.map((p) => ({ x: 1 - p.x, y: p.y, z: p.z })) : null;
    onFrame({
      hand: mirror(result.landmarks[0]),
      second: mirror(result.landmarks[1]),
      t: performance.now() / 1000,
    });
  };
  raf = requestAnimationFrame(loop);

  return () => {
    cancelAnimationFrame(raf);
    landmarker.close();
    stream.getTracks().forEach((track) => track.stop());
    video.srcObject = null;
  };
}
