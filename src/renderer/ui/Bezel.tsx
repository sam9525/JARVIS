import React from "react";
import { FRAME, LBL_CY, LBL_DIM } from "./hud";

type BezelProps = {
  title: string;
  telemetry: string;
  footLeft: React.ReactNode;
  footRight: string;
  /**
   * Entrance for the corner frame. Its presence also writes the readouts in
   * from the left — one signal, two motions, because they are one arrival.
   * Neither can go on the wrapper in App: a transform there would take the
   * scrubber and the voice head with it.
   */
  enterClass?: string;
};

// Fixed window chrome, layer z10, plus the z50 overlay. Everything here is
// pointer-transparent, `footLeft` included: its box spans the window width
// above the ring view's front tile, so whatever inside it must stay
// clickable (the replay scrubber) opts back in with pointer-events-auto.
export default function Bezel({
  title,
  telemetry,
  footLeft,
  footRight,
  enterClass,
}: BezelProps) {
  // every readout, the tick rail included — not only the text ones
  const readout = enterClass ? " boot-slide" : "";
  return (
    <>
      <div
        className={
          FRAME + " inset-2.5 z-10" + (enterClass ? " " + enterClass : "")
        }
      >
        <span className="hud-c3" />
        <span className="hud-c4" />
      </div>
      <div
        className={
          LBL_CY + " pointer-events-none absolute top-3 left-8 z-10" + readout
        }
      >
        {title}
      </div>
      <div
        className={
          LBL_DIM +
          " pointer-events-none absolute top-3 left-[152px] z-10" +
          readout
        }
      >
        {telemetry}
      </div>
      <div
        className={
          "pointer-events-none absolute top-[29px] left-[152px] z-10 w-[250px] overflow-hidden" +
          readout
        }
      >
        <div className="hud-tickrail flex gap-[5px]">
          {Array.from({ length: 50 }, (_, i) => (
            <i key={i} className="h-[5px] w-px flex-none bg-edge" />
          ))}
        </div>
      </div>
      {/* the one interactive layer: the replay scrubber lives here. z16: above
          the overlay (15), below the panel floor (Z_BASE=20) — a panel
          dragged over the scrubber should cover it, not tie with it */}
      {/* stops short of footRight rather than spanning: the scrubber's fill is
          near-opaque and sits higher, so a full-width bar hides the read/edit
          telemetry on every workspace with a non-empty event log */}
      <div className="pointer-events-none absolute right-[220px] bottom-3 left-8 z-[16]">
        {footLeft}
      </div>
      <div
        className={
          LBL_DIM +
          " pointer-events-none absolute right-9 bottom-3 z-10" +
          readout
        }
      >
        {footRight}
      </div>
      <div className="hud-sweep pointer-events-none absolute inset-x-0 h-7 z-[48]" />
      {/* overlay: z15, below the panel band (20-40) — §8 excludes scanlines
          over terminal/preview body text, so these must sit under panels */}
      <div className="hud-scan pointer-events-none absolute inset-0 z-[15]" />
    </>
  );
}
