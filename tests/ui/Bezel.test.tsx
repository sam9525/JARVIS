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

  it("makes every chrome layer pointer-transparent except footLeft", () => {
    // asserting the string appears *somewhere* proves nothing — the vignette
    // alone would satisfy it while four labels silently block the graph
    const el = Bezel(PROPS) as React.ReactElement;
    const layers = React.Children.toArray(el.props.children) as any[];
    const cls = (n: any) => String(n?.props?.className ?? "");
    const foot = layers.find((n) => cls(n).includes("inset-x-8 bottom-3"));
    expect(foot).toBeDefined();
    expect(cls(foot)).not.toContain("pointer-events-none");
    const others = layers.filter((n) => n !== foot);
    expect(others.length).toBeGreaterThan(3);
    for (const layer of others)
      expect(cls(layer)).toContain("pointer-events-none");
  });

  it("renders with no footLeft — the home layout passes null", () => {
    const html = renderToStaticMarkup(<Bezel {...PROPS} footLeft={null} />);
    expect(html).toContain("JARVIS");
    expect(html).toContain("READS 128");
  });

  it("carries the scanline and vignette overlays", () => {
    const html = renderToStaticMarkup(<Bezel {...PROPS} />);
    expect(html).toContain("hud-scan");
    expect(html).toContain("hud-vignette");
  });

  it("carries the sweep and the drifting tick rail", () => {
    const html = renderToStaticMarkup(<Bezel {...PROPS} />);
    expect(html).toContain("hud-tickrail");
    expect(html).toContain("hud-sweep");
  });

  it("gives the foot-left wrapper real extents so Timeline can fill it (C1)", () => {
    const el = Bezel(PROPS) as React.ReactElement;
    const layers = React.Children.toArray(el.props.children) as any[];
    const cls = (n: any) => String(n?.props?.className ?? "");
    const foot = layers.find((n) => cls(n).includes("inset-x-8 bottom-3"));
    expect(foot).toBeDefined();
    // inset-x-8 sets both left and right, so the wrapper has a real width
    // instead of shrink-wrapping to 0 around its absolutely-positioned child
    expect(cls(foot)).toContain("inset-x-8");
    expect(cls(foot)).not.toContain("left-8 z");
  });
});
