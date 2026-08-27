import React, { useEffect, useRef } from "react";
import { isSounding, readWave, WAVE_BINS } from "./speak";
import { LBL_DIM } from "../ui/hud";

const W = 240;
const H = 48;
const MID = H / 2;
// How often to check whether speech has started. The wave is idle almost all
// the time, so a permanent rAF would burn a frame a tick to learn nothing —
// the same reason mission-control cards park their canvas once still.
const IDLE_POLL_MS = 250;
// Mouth height, in SVG units, at silence and at full amplitude. The floor is
// not zero: a closed mouth is a line, not a missing feature.
const MOUTH_SHUT = 0.7;
const MOUTH_OPEN = 4.2;
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

/** Peak deviation from the 128 centre line, as 0..1. */
export function amplitudeOf(buf: Uint8Array): number {
  let peak = 0;
  for (let i = 0; i < buf.length; i++) {
    const d = Math.abs(buf[i] - 128);
    if (d > peak) peak = d;
  }
  return Math.min(peak / 128, 1);
}

/**
 * The main agent's voice, drawn. Head above, waveform below; both go still —
 * mouth shut, bars resting as dots — when nothing is talking.
 *
 * Nothing here is React state. The wave updates at frame rate, and a
 * re-render a frame would restart the force simulation underneath it (the
 * same rule HandCursor follows): the canvas and the mouth are written through
 * refs instead.
 */
export default function VoiceWave() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const mouthRef = useRef<SVGEllipseElement | null>(null);
  const headRef = useRef<SVGSVGElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    // Backing-store scale for the bezel's fixed CSS size. setTransform, not
    // scale: StrictMode runs this effect twice on the same canvas, and scale
    // compounds — the second pass would draw at dpr² and each bar would leave
    // an oversized twin behind it.
    const dpr = window.devicePixelRatio || 1;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const styles = getComputedStyle(document.documentElement);
    const live = styles.getPropertyValue("--color-accent").trim() || "#22d3ee";
    const idle = styles.getPropertyValue("--color-edge").trim() || "#1b3a4a";

    const buf = new Uint8Array(WAVE_BINS);
    const env = new Float32Array(BARS);
    let frame = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;

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

    const setMouth = (open: number) => {
      mouthRef.current?.setAttribute(
        "ry",
        String(MOUTH_SHUT + open * (MOUTH_OPEN - MOUTH_SHUT)),
      );
      headRef.current?.style.setProperty("opacity", open > 0 ? "1" : "0.55");
    };

    const tick = () => {
      if (disposed) return;
      const hasWave = readWave(buf);
      paint(hasWave);
      setMouth(hasWave ? boost(amplitudeOf(buf)) : 0);
      // The local mouth has no waveform to read, so it keeps the head lit
      // while drawing a flat line — speechSynthesis writes straight to the
      // output device and no Web Audio node can see it.
      if (!hasWave && !isSounding()) return idlePoll();
      if (!hasWave) headRef.current?.style.setProperty("opacity", "1");
      frame = requestAnimationFrame(tick);
    };

    const idlePoll = () => {
      timer = setTimeout(() => {
        if (disposed) return;
        if (isSounding()) frame = requestAnimationFrame(tick);
        else idlePoll();
      }, IDLE_POLL_MS);
    };

    tick(); // paint once now, then let tick pick rAF or the idle poll

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      if (timer) clearTimeout(timer);
    };
  }, []);

  return (
    <div
      data-testid="voice-wave"
      className="pointer-events-none flex w-max flex-col gap-1"
    >
      <div className="flex items-end gap-2">
        <svg
          ref={headRef}
          data-testid="voice-head"
          viewBox="0 0 24 24"
          width="30"
          height="30"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.1"
          strokeLinecap="round"
          className="text-accent transition-opacity duration-200"
        >
          <path d="M6 10.5a6 6 0 0 1 12 0v3.2a6 6 0 0 1-6 6 6 6 0 0 1-6-6z" />
          <path d="M9.5 10.2v1.6M14.5 10.2v1.6" />
          <path d="M4.6 9.6V8.2M19.4 9.6V8.2M12 4.5V2.6" />
          <circle cx="12" cy="2" r="0.9" />
          <ellipse
            ref={mouthRef}
            cx="12"
            cy="15.6"
            rx="3"
            ry={MOUTH_SHUT}
            data-testid="voice-mouth"
          />
        </svg>
        <span className={LBL_DIM + " pb-0.5"}>Jarvis</span>
      </div>
      <canvas
        ref={canvasRef}
        data-testid="voice-wave-canvas"
        style={{ width: W, height: H }}
      />
    </div>
  );
}
