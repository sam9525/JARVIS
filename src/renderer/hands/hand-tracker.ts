// Effectful boundary: webcam + MediaPipe HandLandmarker (WASM) → landmark
// frames. startHandTracker is deliberately not unit tested, matching the PTY
// and CLI boundaries; the telemetry block below is, being ordinary
// function-level logic.
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
// The SDK batches usage telemetry to this endpoint. The CSP's connect-src
// blocks it, and each blocked attempt costs a synchronous violation event and
// a stack-capturing console error on the main thread; the batch is not
// discarded on failure, so it grows with inference and every flush replays a
// larger backlog. installMediaPipeTelemetryBlock answers the request locally
// so it never reaches the network layer at all.
export const MEDIAPIPE_LOG_URL = "https://odml.pa.googleapis.com/v1/log";
// matched by host, not by the whole URL: the SDK may append an api key or
// alt= to the path, and an exact compare that misses restores the storm
export const MEDIAPIPE_LOG_HOST = "odml.pa.googleapis.com";

function urlOfFetchInput(input: Parameters<typeof fetch>[0]): string | null {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  if (typeof Request !== "undefined" && input instanceof Request)
    return input.url;
  return null;
}

function isTelemetry(input: Parameters<typeof fetch>[0]): boolean {
  const url = urlOfFetchInput(input);
  if (!url) return false;
  try {
    const host = new URL(url, location.href).hostname;
    return host === MEDIAPIPE_LOG_HOST || host === "play.googleapis.com";
  } catch {
    return false; // unparseable is not ours to swallow
  }
}

export function installMediaPipeTelemetryBlock(): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = ((
    input: Parameters<typeof fetch>[0],
    init?: RequestInit,
  ) => {
    if (isTelemetry(input)) {
      return Promise.resolve(new Response(null, { status: 204 }));
    }
    return original.call(globalThis, input, init);
  }) as typeof fetch;
  return () => {
    if (globalThis.fetch === original) return;
    globalThis.fetch = original;
  };
}

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

  const restoreTelemetry = installMediaPipeTelemetryBlock();

  let landmarker: HandLandmarker;
  try {
    const fileset = await FilesetResolver.forVisionTasks(WASM_DIR);
    landmarker = await HandLandmarker.createFromOptions(fileset, {
      // GPU, measured: detectForVideo is synchronous on the renderer's main
      // thread and the CPU delegate spends strictly more of it per frame
      baseOptions: { modelAssetPath: MODEL_URL, delegate: "GPU" },
      runningMode: "VIDEO",
      numHands: 2, // the zoom needs both palms; the rest use landmarks[0]
    });
  } catch {
    restoreTelemetry();
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
    restoreTelemetry();
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
    // A hand with any non-finite coordinate reads as no hand at all: every
    // consumer downstream is arithmetic, and a NaN reaching the camera sets
    // its position to NaN, which nothing recovers from. This is the boundary.
    const mirror = (lm: Landmark[] | undefined) =>
      lm && lm.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
        ? lm.map((p) => ({ x: 1 - p.x, y: p.y, z: p.z }))
        : null;
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
    restoreTelemetry();
    stream.getTracks().forEach((track) => track.stop());
    video.srcObject = null;
  };
}
