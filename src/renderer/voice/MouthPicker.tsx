import React, { useEffect, useRef, useState } from "react";
import type { MouthRegion } from "../../shared/types";

const SIZE = 520;
// A mark with no drag still has to be openable, or Done would store a region
// no vertex falls inside.
const MIN_HALF = 0.02;
// A fresh mark, in normalised units on a head two units tall: mouth-shaped —
// wide and shallow — so a click alone already marks something plausible.
const DEFAULT_W = 0.16;
const DEFAULT_H = 0.06;
// A press that moves less than this is a click, not an orbit.
const DRAG_PX = 4;
// Slop around the drawn box, so the grab needs no pixel accuracy.
const GRAB_PX = 8;

/** The region a centre and two half-extents describe. Depth follows the wider
 *  of the two, so the box reaches into the lip and stops well short of the
 *  back of the skull. */
function boxAt(c: [number, number, number], w: number, h: number): MouthRegion {
  const hw = Math.max(w, MIN_HALF);
  const hh = Math.max(h, MIN_HALF);
  return { c, w: hw, h: hh, d: Math.max(hw, hh) };
}

/**
 * Mark where a head model's mouth is, for a model that ships no rig.
 *
 * The head renders in colour so a face is actually legible. A drag anywhere
 * orbits it, a click raycasts to the surface and plants the centre, and a drag
 * that starts on the drawn box resizes it — the three cannot collide, because
 * a press only becomes a mark once it lifts without having moved. A click that
 * hits nothing does nothing: a nearest-vertex-anywhere fallback would put a
 * mouth on the back of the head.
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
  // Mirrors regionRef for the button's disabled state and the hint line only.
  // The loop never reads it, so it costs one render per pick, not one a frame.
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
      | ((region: MouthRegion) => {
          x: number;
          y: number;
          w: number;
          h: number;
          visible: boolean;
        } | null)
      | null = null;
    const angle = { yaw: 0, pitch: 0 };
    let frame = 0;
    let mode: "orbit" | "size" | null = null;
    let last = { x: 0, y: 0 };
    let start = { x: 0, y: 0 };
    // Where the box sat when a resize began, plus model units per pixel, so
    // the drag can leave the silhouette — a raycast answers nothing off it.
    // `ox`/`oy` are where in the box the press landed: a resize grows by how
    // far the pointer travels outward, so a press in the middle of the box
    // does not snap it shut on the first pixel of movement.
    let grab = { x: 0, y: 0, ox: 0, oy: 0, w0: 0, h0: 0, wPer: 0, hPer: 0 };

    const drawMarker = () => {
      overlayCtx.clearRect(0, 0, SIZE, SIZE);
      const reg = regionRef.current;
      if (!reg || !project) return;
      const pt = project(reg);
      if (!pt || !pt.visible) return;

      overlayCtx.fillStyle = "rgba(34,211,238,0.18)";
      overlayCtx.fillRect(pt.x - pt.w, pt.y - pt.h, pt.w * 2, pt.h * 2);
      overlayCtx.strokeStyle = "#22d3ee";
      overlayCtx.lineWidth = 1.5;
      overlayCtx.strokeRect(pt.x - pt.w, pt.y - pt.h, pt.w * 2, pt.h * 2);

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
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const reg = regionRef.current;
      const pt = reg && project ? project(reg) : null;
      if (
        reg &&
        pt?.visible &&
        Math.abs(x - pt.x) <= pt.w + GRAB_PX &&
        Math.abs(y - pt.y) <= pt.h + GRAB_PX
      ) {
        mode = "size";
        // Model units per pixel, taken per axis: the box is drawn in a
        // perspective view, so its two half-extents do not share a scale.
        grab = {
          x: pt.x,
          y: pt.y,
          ox: x - pt.x,
          oy: y - pt.y,
          w0: pt.w,
          h0: pt.h,
          wPer: reg.w / pt.w,
          hPer: reg.h / pt.h,
        };
      } else {
        mode = "orbit";
      }
      start = { x: e.clientX, y: e.clientY };
      last = { ...start };
      host.setPointerCapture(e.pointerId);
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
      const c = regionRef.current?.c;
      if (!c) return;
      // The pointer is a corner and the centre stays put, so the drag sets both
      // half-extents at once — which is how a mouth gets to be wide and shallow.
      const rect = host.getBoundingClientRect();
      const dx = Math.abs(e.clientX - rect.left - grab.x) - Math.abs(grab.ox);
      const dy = Math.abs(e.clientY - rect.top - grab.y) - Math.abs(grab.oy);
      regionRef.current = boxAt(
        c,
        (grab.w0 + dx) * grab.wPer,
        (grab.h0 + dy) * grab.hPer,
      );
      invalidate();
    };

    // A press that lifts where it went down is the mark. Picking used to own
    // the press outright, so no drag that started on the face could turn the
    // head without first moving the mouth to wherever the drag began.
    const onUp = (e: PointerEvent) => {
      const moved = Math.hypot(e.clientX - start.x, e.clientY - start.y);
      if (mode === "orbit" && moved < DRAG_PX) {
        const rect = host.getBoundingClientRect();
        const hit =
          raycast?.(e.clientX - rect.left, e.clientY - rect.top) ?? null;
        if (hit) {
          const was = regionRef.current;
          regionRef.current = boxAt(
            hit,
            was?.w ?? DEFAULT_W,
            was?.h ?? DEFAULT_H,
          );
          setMarked(true);
          invalidate();
        }
      }
      mode = null;
    };

    // A cancelled pointer never reports an up, and a mode left set keeps
    // orbiting on the next move that arrives.
    const onCancel = () => {
      mode = null;
    };

    host.addEventListener("pointerdown", onDown);
    host.addEventListener("pointermove", onMove);
    host.addEventListener("pointerup", onUp);
    host.addEventListener("pointercancel", onCancel);

    void (async () => {
      const [{ loadHead }, { mountColourHead, pickOnScene, projectRegion }] =
        await Promise.all([import("./load-head"), import("./head-render")]);
      // Its own parse, not the wave's cached one: mounting a scene that the
      // wave is already drawing would unparent it and blank the bezel head.
      const loaded = await loadHead(headModel, true);
      if (disposed) return;
      head = mountColourHead(host, loaded.scene, SIZE, SIZE);
      raycast = pickOnScene(loaded, SIZE, SIZE, angle);
      project = (region: MouthRegion) =>
        projectRegion(loaded, SIZE, SIZE, angle, region);
      draw(); // paint on the spot; the loop wakes on the next interaction
    })().catch((err) => console.error("mouth picker", err));

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      host.removeEventListener("pointerdown", onDown);
      host.removeEventListener("pointermove", onMove);
      host.removeEventListener("pointerup", onUp);
      host.removeEventListener("pointercancel", onCancel);
      overlayCtx.clearRect(0, 0, SIZE, SIZE);
      head?.dispose();
    };
  }, [headModel]);

  return (
    <div
      className="flex h-full flex-col items-center justify-center gap-2 p-2"
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
      <p className="text-[11.5px] text-ink-dim" data-testid="mouth-pick-hint">
        {marked
          ? "Marked. Drag the box out to a corner to size it, or click elsewhere to move it."
          : "Drag to turn the head. Click its mouth to mark it."}
      </p>
      <div className="flex gap-2" style={{ width: SIZE }}>
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
