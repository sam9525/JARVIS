import React, { useEffect, useRef, useState } from "react";
import type { MouthRegion } from "../../shared/types";

const SIZE = 260;
// A click with no drag still has to mark something openable, or Done would
// store a region no vertex falls inside.
const MIN_R = 0.06;

/** The radius a drag from the centre to a second point describes. */
export function radiusFrom(
  c: [number, number, number],
  to: [number, number, number],
): number {
  return Math.max(Math.hypot(to[0] - c[0], to[1] - c[1], to[2] - c[2]), MIN_R);
}

/**
 * Mark where a head model's mouth is, for a model that ships no rig.
 *
 * The head renders in colour so a face is actually legible; a drag orbits it, a
 * click raycasts to the surface and plants the centre, and dragging out from
 * there sets the radius. A click that hits nothing does nothing — a
 * nearest-vertex-anywhere fallback would put a mouth on the back of the head.
 *
 * The marker is drawn inside the render loop, never held in React state: this
 * folder's rule, because a re-render a frame restarts the graph's force
 * simulation underneath the panel.
 */
export default function MouthPicker({
  headModel,
  initial,
  onDone,
}: {
  headModel?: string;
  initial?: MouthRegion;
  onDone(region: MouthRegion | null): void;
}) {
  // A host element: mountColourHead brings its own canvas.
  const hostRef = useRef<HTMLDivElement | null>(null);
  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const regionRef = useRef<MouthRegion | null>(initial ?? null);
  // Mirrors regionRef for the button's disabled state only. The loop never
  // reads it, so it costs one render per pick rather than one per frame.
  const [marked, setMarked] = useState(Boolean(initial));

  useEffect(() => {
    const host = hostRef.current;
    const overlay = overlayRef.current;
    if (!host || !overlay) return;
    const overlayCtx = overlay.getContext("2d");
    if (!overlayCtx) return;

    const dpr = window.devicePixelRatio || 1;
    overlay.width = SIZE * dpr;
    overlay.height = SIZE * dpr;
    overlayCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

    let disposed = false;
    let head: {
      render(yaw: number, pitch: number): void;
      dispose(): void;
    } | null = null;
    let raycast:
      ((x: number, y: number) => [number, number, number] | null) | null = null;
    let project:
      | ((
          region: MouthRegion,
        ) => { x: number; y: number; r: number; visible: boolean } | null)
      | null = null;
    const angle = { yaw: 0, pitch: 0 };
    let frame = 0;
    let mode: "orbit" | "size" | null = null;
    let last = { x: 0, y: 0 };

    const drawMarker = () => {
      overlayCtx.clearRect(0, 0, SIZE, SIZE);
      const reg = regionRef.current;
      if (!reg || !project) return;
      const pt = project(reg);
      if (!pt || !pt.visible) return;

      overlayCtx.beginPath();
      overlayCtx.arc(pt.x, pt.y, pt.r, 0, Math.PI * 2);
      overlayCtx.strokeStyle = "#22d3ee";
      overlayCtx.lineWidth = 1.5;
      overlayCtx.stroke();

      overlayCtx.beginPath();
      overlayCtx.arc(pt.x, pt.y, 2.5, 0, Math.PI * 2);
      overlayCtx.fillStyle = "#22d3ee";
      overlayCtx.fill();
    };

    // The head is still between interactions, so the loop stops rather than
    // redrawing an unchanged picture at 60 fps in a second WebGL context
    // beside the graph. Every path that moves something invalidates instead.
    const draw = () => {
      frame = 0;
      if (disposed || !head) return;
      head.render(angle.yaw, angle.pitch);
      drawMarker();
    };
    const invalidate = () => {
      if (!frame && !disposed) frame = requestAnimationFrame(draw);
    };

    const onDown = (e: PointerEvent) => {
      const rect = host.getBoundingClientRect();
      const hit =
        raycast?.(e.clientX - rect.left, e.clientY - rect.top) ?? null;
      if (hit) {
        regionRef.current = { c: hit, r: MIN_R };
        setMarked(true);
        mode = "size";
      } else {
        mode = "orbit";
      }
      last = { x: e.clientX, y: e.clientY };
      host.setPointerCapture(e.pointerId);
      invalidate();
    };

    const onMove = (e: PointerEvent) => {
      if (!mode) return;
      if (mode === "orbit") {
        angle.yaw += (e.clientX - last.x) * 0.01;
        angle.pitch += (e.clientY - last.y) * 0.01;
        last = { x: e.clientX, y: e.clientY };
        invalidate();
        return;
      }
      const rect = host.getBoundingClientRect();
      const hit =
        raycast?.(e.clientX - rect.left, e.clientY - rect.top) ?? null;
      const c = regionRef.current?.c;
      if (hit && c) {
        regionRef.current = { c, r: radiusFrom(c, hit) };
        invalidate();
      }
    };

    // pointercancel as well as pointerup: a cancelled pointer never reports an
    // up, and a mode left set keeps orbiting on the next move that arrives.
    const onUp = () => {
      mode = null;
    };

    host.addEventListener("pointerdown", onDown);
    host.addEventListener("pointermove", onMove);
    host.addEventListener("pointerup", onUp);
    host.addEventListener("pointercancel", onUp);

    void (async () => {
      const [{ loadHead }, { mountColourHead, pickOnScene, projectRegion }] =
        await Promise.all([import("./load-head"), import("./head-render")]);
      // Its own parse, not the wave's cached one: mounting a scene that the
      // wave is already drawing would unparent it and blank the bezel head.
      const loaded = await loadHead(headModel, true);
      if (disposed) return;
      head = mountColourHead(host, loaded.scene, SIZE, SIZE);
      raycast = pickOnScene(loaded, SIZE, SIZE, angle);
      if (projectRegion) {
        project = (region: MouthRegion) =>
          projectRegion(loaded, SIZE, SIZE, angle, region);
      }
      draw(); // paint on the spot; the loop wakes on the next interaction
    })().catch((err) => console.error("mouth picker", err));

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      host.removeEventListener("pointerdown", onDown);
      host.removeEventListener("pointermove", onMove);
      host.removeEventListener("pointerup", onUp);
      host.removeEventListener("pointercancel", onUp);
      overlayCtx.clearRect(0, 0, SIZE, SIZE);
      head?.dispose();
    };
  }, [headModel]);

  return (
    <div
      className="flex flex-col items-center gap-2 p-2"
      data-testid="mouth-picker"
    >
      <div className="relative" style={{ width: SIZE, height: SIZE }}>
        <div
          ref={hostRef}
          data-testid="mouth-picker-canvas"
          style={{ width: SIZE, height: SIZE }}
        />
        <canvas
          ref={overlayRef}
          data-testid="mouth-picker-overlay"
          className="pointer-events-none absolute inset-0"
          style={{ width: SIZE, height: SIZE }}
        />
      </div>
      <p className="text-[11.5px] text-ink-dim">
        Drag to turn the head. Click its mouth, then drag out to size it.
      </p>
      <div className="flex w-full gap-2">
        <button
          data-testid="mouth-pick-clear"
          className="flex-1 cursor-pointer rounded-md bg-edge py-1.5 text-ink transition-colors hover:bg-edge/80"
          onClick={() => {
            regionRef.current = null;
            setMarked(false);
            onDone(null);
          }}
        >
          Clear
        </button>
        <button
          data-testid="mouth-pick-done"
          disabled={!marked}
          className="flex-1 cursor-pointer rounded-md bg-accent/20 py-1.5 text-ink transition-colors hover:bg-accent/30 disabled:cursor-default disabled:opacity-40"
          onClick={() => onDone(regionRef.current)}
        >
          Done
        </button>
      </div>
    </div>
  );
}
