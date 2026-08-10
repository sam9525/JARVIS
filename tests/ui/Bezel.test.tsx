import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import Bezel from "../../src/renderer/ui/Bezel";

const PROPS = {
  title: "JARVIS · V0.3.6",
  telemetry: "FLEET 04 · NODES 312",
  footLeft: <span>SESSION REPLAY</span>,
  footRight: "READS 128",
};

describe("Bezel", () => {
  it("renders all four readouts", () => {
    const html = renderToStaticMarkup(<Bezel {...PROPS} />);
    expect(html).toContain("JARVIS");
    expect(html).toContain("FLEET 04");
    expect(html).toContain("SESSION REPLAY");
    expect(html).toContain("READS 128");
  });

  it("draws four corner brackets from one frame element", () => {
    const html = renderToStaticMarkup(<Bezel {...PROPS} />);
    expect(html).toContain("hud-frame");
    expect(html).toContain("hud-c3");
    expect(html).toContain("hud-c4");
  });

  it("never intercepts pointer events — the graph is underneath", () => {
    const html = renderToStaticMarkup(<Bezel {...PROPS} />);
    expect(html).toContain("pointer-events-none");
  });

  it("carries the scanline and vignette overlays", () => {
    const html = renderToStaticMarkup(<Bezel {...PROPS} />);
    expect(html).toContain("hud-scan");
    expect(html).toContain("hud-vignette");
  });
});
