// Dev-only diagnostics for an unresponsive renderer. Three failures look
// identical from the outside — the window stops responding — and each prints
// something different here:
//
//   STALL — the main thread blocked, with the duration and the live hand
//     state. detectForVideo runs synchronously on this thread.
//   WEBGL CONTEXT LOST — the driver reset the canvas out from under three.js.
//     react-force-graph does not rebuild on restore, so the scene stays dead.
//   UNCAUGHT / REJECTED — a throw inside the animation loop, which kills the
//     loop permanently. The stack names the culprit.
//
// Wired from index.tsx behind import.meta.env.DEV, so a packaged build never
// carries it. Log-only by design — nothing here may change what the app does.

const STALL_MS = 900; // a 500 ms interval this late means the thread was held

export function startDevProbes(): void {
  let last = performance.now();
  setInterval(() => {
    const now = performance.now();
    const gap = Math.round(now - last);
    last = now;
    if (gap <= STALL_MS) return;
    const hands = (window as unknown as { __hands?: unknown }).__hands;
    console.warn("STALL", gap, "ms | hands", hands);
  }, 500);

  // Capture phase on window, not a listener on the canvas: the canvas is
  // created by react-force-graph and replaced on every remount (the ring
  // rebuilds it per settle), and webglcontextlost does not bubble. A capture
  // listener on an ancestor still fires for a non-bubbling event.
  window.addEventListener(
    "webglcontextlost",
    (e) => console.error("WEBGL CONTEXT LOST", e),
    true,
  );
  window.addEventListener(
    "webglcontextrestored",
    () => console.error("WEBGL CONTEXT RESTORED"),
    true,
  );

  window.addEventListener("error", (e) =>
    console.error("UNCAUGHT", e.message, e.filename, e.lineno),
  );
  window.addEventListener("unhandledrejection", (e) =>
    console.error("REJECTED", e.reason),
  );

  console.info(
    "dev probes armed — watching for STALL, WEBGL CONTEXT LOST, UNCAUGHT",
  );
}
