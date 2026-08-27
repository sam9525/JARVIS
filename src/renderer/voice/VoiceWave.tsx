import React, { useEffect, useRef } from "react";
import { isSounding, readWave, WAVE_BINS } from "./speak";
import { LBL_DIM } from "../ui/hud";

const W = 180;
const H = 26;
const MID = H / 2;
// How often to check whether speech has started. The wave is idle almost all
// the time, so a permanent rAF would burn a frame a tick to learn nothing —
// the same reason mission-control cards park their canvas once still.
const IDLE_POLL_MS = 250;
// Mouth height, in SVG units, at silence and at full amplitude. The floor is
// not zero: a closed mouth is a line, not a missing feature.
const MOUTH_SHUT = 0.7;
const MOUTH_OPEN = 4.2;

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
 * mouth shut, line flat — when nothing is talking.
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

    // one-time backing-store scale: the bezel is a fixed CSS size, so this
    // never needs recomputing for a resize
    const dpr = window.devicePixelRatio || 1;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.scale(dpr, dpr);

    const styles = getComputedStyle(document.documentElement);
    const live = styles.getPropertyValue("--color-accent").trim() || "#22d3ee";
    const idle = styles.getPropertyValue("--color-edge").trim() || "#1b3a4a";

    const buf = new Uint8Array(WAVE_BINS);
    let frame = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;

    const paint = (hasWave: boolean) => {
      ctx.clearRect(0, 0, W, H);
      ctx.lineWidth = 1.5;
      ctx.lineJoin = "round";
      ctx.strokeStyle = hasWave ? live : idle;
      ctx.beginPath();
      if (!hasWave) {
        ctx.moveTo(0, MID);
        ctx.lineTo(W, MID);
      } else {
        for (let x = 0; x < W; x++) {
          const v = buf[Math.floor((x / W) * buf.length)] - 128;
          const y = MID - (v / 128) * (MID - 1);
          if (x === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
      }
      ctx.stroke();
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
      setMouth(hasWave ? amplitudeOf(buf) : 0);
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
