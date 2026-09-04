import React, { useEffect, useRef, useState } from "react";
import { isSounding, mouthOpen, readWave, WAVE_BINS } from "./speak";
import {
  aimFrom,
  denormalisePoint,
  normalisePoint,
  recomputeNormals,
  visibleEdges,
} from "./head-mesh";
import type { LoadedHead } from "./load-head";
import type { Rig, RigKind } from "./head-rig";
import type { MouthRegion } from "../../shared/types";
import type { Vector3 } from "three";

const W = 240;
const H = 48;
const MID = H / 2;
// The head shares the wave's width so the pair reads as one column.
const HEAD_W = W;
const HEAD_H = 200;
// The model is normalised to two units tall; this is what fits it to the box.
const HEAD_SCALE = 76;
// Hairline, because ten thousand edges at any heavier weight fill in solid.
const HEAD_LINE = 0.4;
// How often to check whether speech has started. The wave is idle almost all
// the time, so a permanent rAF would burn a frame a tick to learn nothing —
// the same reason mission-control cards park their canvas once still.
const IDLE_POLL_MS = 250;
// Share of the remaining angle the head turns each frame, and the angle below
// which it counts as arrived so the loop can stop.
const TURN = 0.12;
const SETTLED = 0.002;
// Speech peaks well under full scale — a normal TTS line sits near a tenth of
// the byte range, which on a strip this short is a flat line with a wobble.
// The wave is an indicator, not a meter, so it is drawn with gain and clipped.
// ponytail: fixed gain; make it a running-peak normaliser if a voice ever
// clips flat or vanishes at this setting.
const GAIN = 3;

const boost = (x: number) => Math.min(x * GAIN, 1);

// The fallback voice hands out no audio at all, so the mouth chatters on a
// clock while it sounds rather than sitting shut through every word.
// ponytail: a fixed rate; drive it from real amplitude if speechSynthesis ever
// grants any.
const MIME_HZ = 5;
const mime = () =>
  0.35 + 0.35 * Math.sin((performance.now() / 1000) * MIME_HZ * Math.PI * 2);

// What face detection made of each head, by model name — null included, so a
// head with no findable mouth is not re-searched on every mode flip.
const found = new Map<string, MouthRegion | null>();

// The mouth opens on `mouthOpen`, which reads the buffer as RMS rather than
// as the loudest bin the bars use, and eased on top of that so one noisy frame
// cannot snap the jaw.
const MOUTH_SMOOTH = 0.4;

// The strip is an equalizer, not an oscilloscope: the raw time domain stretched
// across the strip is speech-rate oscillation, legible as hash. Each bar is the
// peak of its slice, eased toward its new value so one noisy frame cannot spike
// it, and it rests as a dot rather than collapsing to nothing.
const BARS = 48;
const SMOOTH = 0.3;
const SPACING = W / BARS;
// Bar thickness as a share of its slot, so the look survives a change to W or
// BARS instead of needing a matching pixel constant.
const BAR_W = SPACING * 0.3;
// Half-height of a resting bar. A zero-length stroke draws nothing, so the
// silent state is a short segment with a round cap — which is a dot.
const DOT = 0.7;

/**
 * The main agent's voice, drawn. A wireframe head above, waveform below; both
 * go still — mouth shut, bars resting as dots — when nothing is talking. The
 * head turns to face the pointer, with the app's centre as the front face.
 *
 * Nothing here is React state. Both canvases update at frame rate, and a
 * re-render a frame would restart the force simulation underneath them (the
 * same rule HandCursor follows): they are written through refs instead.
 */
export default function VoiceWave({
  headModel,
  colour,
  mouth,
  mouthRegion,
  onRig,
  onHeadError,
  onColoured,
  visible,
}: {
  headModel?: string;
  /**
   * Whether the bezel around this is open yet. The entrance waits for it: this
   * sits inside the bezel's `boot-hold`, and on a slow boot the whole 480ms
   * would elapse behind `visibility: hidden` and the head would just appear.
   * Absent means visible — the mid-session 🎤 mounts straight onto the screen.
   */
  visible?: boolean;
  colour?: boolean;
  mouth?: boolean;
  mouthRegion?: MouthRegion;
  onRig?: (kind: RigKind) => void;
  onHeadError?: (why: string | null) => void;
  onColoured?: (has: boolean) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const headRef = useRef<HTMLCanvasElement | null>(null);
  // A host element, not a canvas: mountColourHead brings its own, because a
  // canvas whose context was force-lost can never grant another one.
  const colourRef = useRef<HTMLDivElement | null>(null);
  // Whether the head on screen carries colours of its own. The one piece of
  // React state here, and not a per-frame one: it settles once per head, and
  // the choice of canvas below depends on it. Without it a colour host with
  // nothing mounted inside draws no head at all — the caller cannot be trusted
  // to gate `colour`, because `onColoured` is optional.
  const [colourable, setColourable] = useState(true);
  const showColour = !!colour && colourable;
  const mouthRef = useRef(mouth);
  mouthRef.current = mouth;
  const startRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    mouthRef.current = mouth;
    startRef.current?.();
  }, [mouth]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    const headCanvas = headRef.current;
    const head2d = headCanvas?.getContext("2d");
    if (!canvas || !ctx) return;
    if (!showColour && (!headCanvas || !head2d)) return;
    if (showColour && !colourRef.current) return;

    // Backing-store scale for the bezel's fixed CSS size. setTransform, not
    // scale: StrictMode runs this effect twice on the same canvas, and scale
    // compounds — the second pass would draw at dpr² and each bar would leave
    // an oversized twin behind it. The head's transform also carries its
    // origin, so the mesh keeps its own coordinates centred on zero.
    const dpr = window.devicePixelRatio || 1;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (!showColour && headCanvas && head2d) {
      headCanvas.width = HEAD_W * dpr;
      headCanvas.height = HEAD_H * dpr;
      head2d.setTransform(
        dpr,
        0,
        0,
        dpr,
        (HEAD_W / 2) * dpr,
        (HEAD_H / 2) * dpr,
      );
    }

    const styles = getComputedStyle(document.documentElement);
    const live = styles.getPropertyValue("--color-accent").trim() || "#22d3ee";
    const idle = styles.getPropertyValue("--color-edge").trim() || "#1b3a4a";

    const buf = new Uint8Array(WAVE_BINS);
    const env = new Float32Array(BARS);
    const angle = { yaw: 0, pitch: 0 };
    const aim = { yaw: 0, pitch: 0 };
    let rig: Rig | null = null;
    let open = 0;
    let scratch: Vector3 | null = null;
    // The masked vertices each mesh owns, and one scratch point for the trip
    // back into file units — a frame writing the mouth allocates nothing.
    let poseParts: Uint32Array[] | null = null;
    const back = new Float32Array(3);
    let frame = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;
    let running = false;
    let head: LoadedHead | null = null;
    let colourHead: import("./head-render").ColourHead | null = null;

    // Detection needs a picture of the head, so it borrows the colour renderer
    // for exactly one frame on an offscreen canvas. Square, because landmarks
    // come back normalised per axis and a 240×200 frame would skew them.
    const DETECT_SIZE = 256;
    const detectFront = async (loaded: LoadedHead) => {
      try {
        if (!loaded.scene?.isObject3D && !loaded.scene?.dispatchEvent)
          return null;
        const off = document.createElement("div");
        const [{ mountColourHead }, { detectMouth }] = await Promise.all([
          import("./head-render"),
          import("./detect-mouth"),
        ]);
        const shot = mountColourHead(
          off,
          loaded.scene,
          DETECT_SIZE,
          DETECT_SIZE,
        );
        shot.render(0, 0);
        try {
          // The detector uploads this through texImage2D, so it must be the
          // rendered canvas, not the host box that holds it.
          return await detectMouth(
            loaded.model,
            shot.canvas,
            HEAD_SCALE,
            DETECT_SIZE,
          );
        } finally {
          shot.dispose();
        }
      } catch {
        return null;
      }
    };

    // The morph and bone tiers deform on the GPU, so the wireframe reads the
    // result back: getVertexPosition applies morph targets, and SkinnedMesh
    // overrides it to apply skinning too. The region tiers write `pose`
    // themselves and skip this.
    const readBackPose = (loaded: LoadedHead) => {
      if (!scratch) return;
      if (rig?.kind === "manual" || rig?.kind === "detected") return;
      // A bone tier writes a rotation, and skinning reads the bones'
      // matrixWorld — which only a render refreshes. Colour mode renders; the
      // wireframe never does, so without this the jaw moves in one mode only.
      loaded.scene.updateMatrixWorld(true);
      for (const part of loaded.parts) {
        part.mesh.skeleton?.update();
        for (let i = 0; i < part.count; i++) {
          part.mesh.getVertexPosition(i, scratch);
          part.mesh.localToWorld(scratch);
          normalisePoint(
            loaded.model,
            scratch.x,
            scratch.y,
            scratch.z,
            loaded.model.pose,
            (part.start + i) * 3,
          );
        }
      }
      recomputeNormals(loaded.model);
    };

    // The other direction, for colour mode: that renderer draws the file's own
    // geometry and never looks at the CPU model, so a region tier's
    // displacement has to be copied into the buffer it does draw. Only the
    // masked vertices ever move, so a dense head costs the mouth, not the mesh.
    const writeBackPose = (loaded: LoadedHead) => {
      if (!scratch || !poseParts) return;
      for (let p = 0; p < loaded.parts.length; p++) {
        const own = poseParts[p];
        if (own.length === 0) continue;
        const part = loaded.parts[p];
        const attr = part.mesh.geometry?.attributes?.position;
        if (!attr) continue;
        for (let k = 0; k < own.length; k++) {
          const v = own[k] * 3;
          denormalisePoint(
            loaded.model,
            loaded.model.pose[v],
            loaded.model.pose[v + 1],
            loaded.model.pose[v + 2],
            back,
          );
          scratch.set(back[0], back[1], back[2]).applyMatrix4(part.inv);
          attr.setXYZ(own[k] - part.start, scratch.x, scratch.y, scratch.z);
        }
        attr.needsUpdate = true;
      }
    };

    // Which of the mask's vertices each mesh owns, worked out once when the rig
    // resolves. Walking every part for every masked vertex is the same answer
    // every frame, and a twenty-mesh head pays it twenty times over.
    const bucketMask = (loaded: LoadedHead) => {
      const mask = rig?.mask;
      if (!mask) {
        poseParts = null;
        return;
      }
      const buckets: number[][] = loaded.parts.map(() => []);
      for (const i of mask.idx) {
        for (let p = 0; p < loaded.parts.length; p++) {
          const at = i - loaded.parts[p].start;
          if (at >= 0 && at < loaded.parts[p].count) {
            buckets[p].push(i);
            break;
          }
        }
      }
      poseParts = buckets.map((b) => Uint32Array.from(b));
    };

    // One name for both directions: which renderer is on screen decides which
    // way the pose has to travel, and the caller has no business knowing.
    const syncPose = (loaded: LoadedHead) => {
      if (colourHead) writeBackPose(loaded);
      else readBackPose(loaded);
    };

    const paint = (hasWave: boolean) => {
      ctx.clearRect(0, 0, W, H);
      ctx.lineWidth = BAR_W;
      ctx.lineCap = "round";
      ctx.strokeStyle = hasWave ? live : idle;
      if (!hasWave) env.fill(0);
      const per = buf.length / BARS;
      for (let b = 0; b < BARS; b++) {
        if (hasWave) {
          let peak = 0;
          for (
            let i = Math.floor(b * per);
            i < Math.floor((b + 1) * per);
            i++
          ) {
            const d = Math.abs(buf[i] - 128);
            if (d > peak) peak = d;
          }
          env[b] += (boost(peak / 128) - env[b]) * SMOOTH;
        }
        const half = Math.max(DOT, env[b] * (MID - BAR_W / 2));
        const x = (b + 0.5) * SPACING;
        ctx.beginPath();
        ctx.moveTo(x, MID - half);
        ctx.lineTo(x, MID + half);
        ctx.stroke();
      }
    };

    // One path and one stroke for the whole helmet. Ten thousand separate
    // stroke calls is what would cost a frame, not the segment count.
    const paintHead = (lit: boolean) => {
      if (!head2d) return;
      head2d.clearRect(-HEAD_W / 2, -HEAD_H / 2, HEAD_W, HEAD_H);
      if (!head) return;
      head2d.lineWidth = HEAD_LINE;
      head2d.strokeStyle = lit ? live : idle;
      const seg = visibleEdges(head.model, angle.yaw, angle.pitch, HEAD_SCALE);
      head2d.beginPath();
      for (let i = 0; i < seg.length; i += 4) {
        head2d.moveTo(seg[i], seg[i + 1]);
        head2d.lineTo(seg[i + 2], seg[i + 3]);
      }
      head2d.stroke();
    };

    const settled = () =>
      Math.abs(aim.yaw - angle.yaw) < SETTLED &&
      Math.abs(aim.pitch - angle.pitch) < SETTLED;

    const tick = () => {
      if (disposed) return;
      const hasWave = readWave(buf);
      // The local mouth has no waveform to read, so it keeps the head lit
      // while drawing a flat line — speechSynthesis writes straight to the
      // output device and no Web Audio node can see it.
      const sounding = isSounding();
      paint(hasWave);
      if (rig && rig.kind !== "none") {
        if (mouthRef.current) {
          const target = hasWave ? mouthOpen(buf) : sounding ? mime() : 0;
          open += (target - open) * MOUTH_SMOOTH;
          // A still mouth on a turning head moved nothing, and copying the pose
          // across costs the same whether or not it changed.
          if (rig.apply(open, !colourHead) && head) syncPose(head);
        } else if (open > 0) {
          open = 0;
          if (rig.apply(0, !colourHead) && head) syncPose(head);
        }
      }
      if (settled()) {
        angle.yaw = aim.yaw;
        angle.pitch = aim.pitch;
      } else {
        angle.yaw += (aim.yaw - angle.yaw) * TURN;
        angle.pitch += (aim.pitch - angle.pitch) * TURN;
      }
      if (colourHead) colourHead.render(angle.yaw, angle.pitch);
      else paintHead(hasWave || sounding);
      if (hasWave || sounding || !settled()) {
        frame = requestAnimationFrame(tick);
        return;
      }
      running = false;
      idlePoll();
    };

    const idlePoll = () => {
      timer = setTimeout(() => {
        if (disposed) return;
        if (isSounding()) start();
        else idlePoll();
      }, IDLE_POLL_MS);
    };

    // A still pointer over a silent app costs no frames; only motion, sound or
    // the model arriving starts the loop back up. It paints on the spot rather
    // than scheduling, so a restart shows this frame instead of the next.
    const start = () => {
      if (running || disposed) return;
      running = true;
      if (timer) clearTimeout(timer);
      timer = null;
      tick();
    };
    startRef.current = start;

    const onPointer = (e: PointerEvent) => {
      const next = aimFrom(
        e.clientX,
        e.clientY,
        window.innerWidth,
        window.innerHeight,
      );
      aim.yaw = next.yaw;
      aim.pitch = next.pitch;
      start();
    };
    window.addEventListener("pointermove", onPointer);

    running = true;
    tick(); // paint once now, then let tick pick rAF or the idle poll

    // load-head drags GLTFLoader and the whole of three with it, so it is
    // imported here rather than at module scope — the same boundary that
    // keeps the whisper pipeline out of renderer startup. The head arrives a
    // moment after the wave; `start` draws it once and the loop settles
    // again, so nothing spins waiting for the file.
    import("./load-head")
      .then(({ loadHead }) => loadHead(headModel))
      .then(async (loaded) => {
        if (disposed) return;
        head = loaded;
        const [{ resolveRig }, { Vector3 }] = await Promise.all([
          import("./head-rig"),
          import("three"),
        ]);
        if (disposed) return;
        scratch = new Vector3();
        // Detection only earns its offscreen render when nothing cheaper can
        // answer, so it runs after a pick is ruled out and the tiers above it
        // decide whether its result is ever consulted.
        let rigCandidate = resolveRig(
          loaded.scene,
          loaded.model,
          mouthRegion ?? null,
          null,
        );
        if (rigCandidate.kind === "none" && !mouthRegion) {
          const key = headModel ?? "";
          // Detection loads MediaPipe and renders the head offscreen. The
          // colour switch remounts this effect, and paying that again for a
          // head that has already answered is what makes the switch feel stuck.
          const detected = found.has(key)
            ? (found.get(key) ?? null)
            : await detectFront(loaded);
          found.set(key, detected);
          if (disposed) return;
          if (detected) {
            rigCandidate = resolveRig(
              loaded.scene,
              loaded.model,
              null,
              detected,
            );
          }
        }
        rig = rigCandidate;
        bucketMask(loaded);
        onRig?.(rig.kind);
        onHeadError?.(null);
        // What the file carries decides whether colour mode is offered at all,
        // and only the loaded model knows.
        onColoured?.(loaded.coloured);
        // A colourless head falls back to the wireframe here rather than in
        // the caller: this re-renders, the effect re-runs on `showColour`, and
        // the second pass takes the wire branch.
        setColourable(loaded.coloured);
        if (showColour && loaded.coloured && colourRef.current) {
          const { mountColourHead } = await import("./head-render");
          if (disposed) return;
          colourHead = mountColourHead(
            colourRef.current,
            loaded.scene,
            HEAD_W,
            HEAD_H,
          );
        }
        start();
      })
      .catch((err) => {
        // A head that will not load leaves an empty box and no reason for it,
        // so the message goes where the head was chosen.
        console.error("head model", err);
        if (!disposed)
          onHeadError?.(err instanceof Error ? err.message : String(err));
      });

    // headModel / colour: a different head or a different renderer means a
    // different loop, and the effect owns it. Tearing the whole thing down is
    // the cheap and correct swap — it disposes the listener, the timer and the
    // WebGL context with it.

    return () => {
      disposed = true;
      startRef.current = null;
      window.removeEventListener("pointermove", onPointer);
      cancelAnimationFrame(frame);
      if (timer) clearTimeout(timer);
      colourHead?.dispose();
    };
  }, [headModel, showColour, mouthRegion, onRig, onHeadError, onColoured]);

  return (
    <div
      data-testid="voice-wave"
      // Head and wave enter as one instrument — splitting them would run past
      // the 480 ms hold stage 0 gives the bezel. The class lands when the bezel
      // opens rather than at mount, so the run is never spent behind its hold.
      className={
        (visible === false ? "" : "boot-in ") +
        "pointer-events-none flex w-max flex-col gap-1"
      }
    >
      {/* The keys are what make this a swap rather than a reuse. Both branches
          are a <canvas> in the same slot, so React would keep the same DOM node
          and only move the ref — and a canvas grants one context for its whole
          life. The reused node hands back null for the other kind: WebGL on the
          node that drew the wireframe throws "Error creating WebGL context",
          and 2D on the node that drew in colour comes back null and the effect
          bails, which is a head that never draws again until a restart. */}
      {showColour ? (
        <div
          key="colour"
          ref={colourRef}
          data-testid="voice-head-colour"
          style={{ width: HEAD_W, height: HEAD_H }}
        />
      ) : (
        <canvas
          key="wire"
          ref={headRef}
          data-testid="voice-head"
          style={{ width: HEAD_W, height: HEAD_H }}
        />
      )}
      <canvas
        ref={canvasRef}
        data-testid="voice-wave-canvas"
        style={{ width: W, height: H }}
      />
    </div>
  );
}
