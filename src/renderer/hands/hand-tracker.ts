// Effectful boundary: webcam + MediaPipe HandLandmarker (WASM) → landmark
// frames. Deliberately not unit tested, matching the PTY and CLI boundaries.
import { FilesetResolver, HandLandmarker } from "@mediapipe/tasks-vision";
import type { Landmark } from "./pinch";

export type HandFrame = { hand: Landmark[] | null; t: number }; // t in seconds

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
      numHands: 1,
    });
  } catch {
    stream.getTracks().forEach((track) => track.stop());
    throw new Error("Hand tracker failed to load");
  }

  const video = document.createElement("video");
  video.srcObject = stream;
  video.muted = true;
  await video.play();

  let raf = 0;
  let lastVideoT = -1;
  const loop = () => {
    raf = requestAnimationFrame(loop);
    if (video.currentTime === lastVideoT) return; // no new camera frame yet
    lastVideoT = video.currentTime;
    const result = landmarker.detectForVideo(video, performance.now());
    const lm = result.landmarks[0];
    onFrame({
      // mirror x so moving the hand right reads as pointer-right — the same
      // sign a mouse drag produces, which is what the gesture layer assumes
      hand: lm ? lm.map((p) => ({ x: 1 - p.x, y: p.y })) : null,
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
