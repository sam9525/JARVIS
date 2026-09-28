import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ENTER_MS } from "../../src/renderer/ui/boot-stage";
import { FOLD_MS, PANEL_OUT_MS } from "../../src/renderer/ui/Panel";

// The boot sequence holds each stage open for exactly as long as the CSS spends
// animating it, so a TS constant and its keyframe have to agree. Nothing else
// enforces that: drift is silent, and the symptom is a stage opening over a run
// still in flight — which reads as a glitch, not as a broken number.
const css = fs.readFileSync(
  path.join(__dirname, "../../src/renderer/index.css"),
  "utf8",
);

/**
 * The seconds in `.name { animation: … <n>s … }` or `transition: … <n>s`.
 * Every class is declared twice — once for real and once in the
 * reduced-motion block, which comes first in the file and carries no
 * duration — so this takes the declaration that has one.
 */
function durationOf(className: string): number {
  const blocks = [
    ...css.matchAll(new RegExp(`\\.${className}\\s*\\{([^}]*)\\}`, "g")),
  ];
  if (!blocks.length) throw new Error(`.${className} is not in index.css`);
  for (const b of blocks) {
    const secs = /(\d*\.?\d+)s/.exec(b[1]);
    if (secs) return Math.round(Number(secs[1]) * 1000);
  }
  throw new Error(`.${className} declares no duration`);
}

describe("animation durations", () => {
  it("holds each boot stage for as long as its entrance runs", () => {
    for (const c of ["boot-in", "boot-fade", "boot-frame", "boot-slide"])
      expect(durationOf(c), c).toBe(ENTER_MS);
  });

  it("unmounts a panel when its exit ends, not before", () => {
    expect(durationOf("panel-out")).toBe(PANEL_OUT_MS);
  });

  it("disarms the fold transition when the fold ends, not before", () => {
    expect(durationOf("panel-fold")).toBe(FOLD_MS);
  });

  // every one of these is switched off or shortened for reduced motion, and a
  // close that waits on an animation nobody runs never completes
  it("names every new animation in the reduced-motion block", () => {
    const block =
      /prefers-reduced-motion:\s*reduce\s*\)\s*\{([\s\S]*?)\n {2}\}/.exec(css);
    expect(block, "no prefers-reduced-motion block in index.css").toBeTruthy();
    for (const c of [
      "boot-in",
      "boot-fade",
      "boot-frame",
      "boot-slide",
      "panel-in",
      "panel-out",
      "composer-in",
      "panel-fold",
      "segmented-fill",
    ])
      expect(block![1], c).toContain(`.${c}`);
  });
});
