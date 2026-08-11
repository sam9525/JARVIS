import React from "react";
import { FRAME, LBL_CY, LBL_DIM } from "./hud";

type BezelProps = {
  title: string;
  telemetry: string;
  footLeft: React.ReactNode;
  footRight: string;
};

// Fixed window chrome, layer z10, plus the z50 overlay. Everything here is
// pointer-transparent except `footLeft`, which carries the replay scrubber on
// the workspace layout and must stay clickable.
export default function Bezel({
  title,
  telemetry,
  footLeft,
  footRight,
}: BezelProps) {
  return (
    <>
      <div className={FRAME + " inset-2.5 z-10"}>
        <span className="hud-c3" />
        <span className="hud-c4" />
      </div>
      <div
        className={LBL_CY + " pointer-events-none absolute top-3 left-8 z-10"}
      >
        {title}
      </div>
      <div
        className={
          LBL_DIM + " pointer-events-none absolute top-3 left-[152px] z-10"
        }
      >
        {telemetry}
      </div>
      <div className="pointer-events-none absolute top-[29px] left-[152px] z-10 w-[250px] overflow-hidden">
        <div className="hud-tickrail flex gap-[5px]">
          {Array.from({ length: 50 }, (_, i) => (
            <i key={i} className="h-[5px] w-px flex-none bg-edge" />
          ))}
        </div>
      </div>
      {/* the one interactive layer: the replay scrubber lives here. z16: above
          the overlay (15), below the panel floor (Z_BASE=20) — a panel
          dragged over the scrubber should cover it, not tie with it */}
      <div className="absolute inset-x-8 bottom-3 z-16">{footLeft}</div>
      <div
        className={
          LBL_DIM + " pointer-events-none absolute right-9 bottom-3 z-10"
        }
      >
        {footRight}
      </div>
      <div className="hud-sweep pointer-events-none absolute inset-x-0 h-7 z-[48]" />
      {/* overlay: z15, below the panel band (20-40) — §8 excludes scanlines
          over terminal/preview body text, so these must sit under panels */}
      <div className="hud-vignette pointer-events-none absolute inset-0 z-[15]" />
      <div className="hud-scan pointer-events-none absolute inset-0 z-[15]" />
    </>
  );
}
