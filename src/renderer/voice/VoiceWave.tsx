import React, { useEffect, useRef } from "react";
import { isSounding, readWave, WAVE_BINS } from "./speak";
import { aimFrom, visibleEdges, type HeadModel } from "./head-mesh";

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
export default function VoiceWave({ headModel }: { headModel?: string }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const headRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    const headCanvas = headRef.current;
    const head2d = headCanvas?.getContext("2d");
    if (!canvas || !ctx || !headCanvas || !head2d) return;

    // Backing-store scale for the bezel's fixed CSS size. setTransform, not
    // scale: StrictMode runs this effect twice on the same canvas, and scale
    // compounds — the second pass would draw at dpr² and each bar would leave
    // an oversized twin behind it. The head's transform also carries its
    // origin, so the mesh keeps its own coordinates centred on zero.
    const dpr = window.devicePixelRatio || 1;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    headCanvas.width = HEAD_W * dpr;
    headCanvas.height = HEAD_H * dpr;
    head2d.setTransform(dpr, 0, 0, dpr, (HEAD_W / 2) * dpr, (HEAD_H / 2) * dpr);

    const styles = getComputedStyle(document.documentElement);
    const live = styles.getPropertyValue("--color-accent").trim() || "#22d3ee";
    const idle = styles.getPropertyValue("--color-edge").trim() || "#1b3a4a";

    const buf = new Uint8Array(WAVE_BINS);
    const env = new Float32Array(BARS);
    const angle = { yaw: 0, pitch: 0 };
    const aim = { yaw: 0, pitch: 0 };
    let frame = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;
    let running = false;
    let head: import("./load-head").LoadedHead | null = null;

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
      paint(hasWave);
      if (settled()) {
        angle.yaw = aim.yaw;
        angle.pitch = aim.pitch;
      } else {
        angle.yaw += (aim.yaw - angle.yaw) * TURN;
        angle.pitch += (aim.pitch - angle.pitch) * TURN;
      }
      // The local mouth has no waveform to read, so it keeps the head lit
      // while drawing a flat line — speechSynthesis writes straight to the
      // output device and no Web Audio node can see it.
      const sounding = isSounding();
      paintHead(hasWave || sounding);
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
      .then((loaded) => {
        if (disposed) return;
        head = loaded;
        start();
      })
      .catch((err) => console.error("head model", err));

    // headModel: a different head means a different model, and the effect owns
    // the loop that draws it. Tearing the whole thing down is the cheap and
    // correct way to swap — it disposes the listener and the timer with it.

    return () => {
      disposed = true;
      window.removeEventListener("pointermove", onPointer);
      cancelAnimationFrame(frame);
      if (timer) clearTimeout(timer);
    };
  }, [headModel]);

  return (
    <div
      data-testid="voice-wave"
      className="pointer-events-none flex w-max flex-col gap-1"
    >
      <canvas
        ref={headRef}
        data-testid="voice-head"
        style={{ width: HEAD_W, height: HEAD_H }}
      />
      <canvas
        ref={canvasRef}
        data-testid="voice-wave-canvas"
        style={{ width: W, height: H }}
      />
    </div>
  );
}
