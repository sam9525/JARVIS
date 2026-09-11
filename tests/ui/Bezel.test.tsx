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

  it("puts the entrance on the frame alone, not on a readout", () => {
    // a transform on the wrapper would scale the scrubber and the voice head,
    // so only the corner frame carries the lock-on
    const el = Bezel({
      ...PROPS,
      enterClass: "boot-frame",
    }) as React.ReactElement<any>;
    const layers = React.Children.toArray(el.props.children) as any[];
    const cls = (n: any) => String(n?.props?.className ?? "");
    const framed = layers.filter((n) => cls(n).includes("boot-frame"));
    expect(framed).toHaveLength(1);
    expect(cls(framed[0])).toContain("hud-frame");
  });

  it("writes the readouts in alongside the frame", () => {
    // a bare opacity fade on 11px dim type is not something you can see happen
    const html = renderToStaticMarkup(
      <Bezel {...PROPS} enterClass="boot-frame" />,
    );
    // title, telemetry, tick rail, footRight
    expect(html.split("boot-slide").length - 1).toBe(4);
  });

  it("carries no entrance class when none is given", () => {
    const html = renderToStaticMarkup(<Bezel {...PROPS} />);
    expect(html).not.toContain("boot-frame");
    expect(html).not.toContain("boot-slide");
  });

  it("makes every chrome layer pointer-transparent except footLeft", () => {
    // asserting the string appears *somewhere* proves nothing — the vignette
    // alone would satisfy it while four labels silently block the graph
    const el = Bezel(PROPS) as React.ReactElement<any>;
    const layers = React.Children.toArray(el.props.children) as any[];
    const cls = (n: any) => String(n?.props?.className ?? "");
    const foot = layers.find((n) => cls(n).includes("z-[16]"));
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

  it("carries the scanline overlay", () => {
    const html = renderToStaticMarkup(<Bezel {...PROPS} />);
    expect(html).toContain("hud-scan");
  });

  it("carries the sweep and the drifting tick rail", () => {
    const html = renderToStaticMarkup(<Bezel {...PROPS} />);
    expect(html).toContain("hud-tickrail");
    expect(html).toContain("hud-sweep");
  });

  it("gives the foot-left wrapper real extents so Timeline can fill it (C1)", () => {
    const el = Bezel(PROPS) as React.ReactElement<any>;
    const layers = React.Children.toArray(el.props.children) as any[];
    const cls = (n: any) => String(n?.props?.className ?? "");
    const foot = layers.find((n) => cls(n).includes("z-[16]"));
    expect(foot).toBeDefined();
    // both left and right are set, so the wrapper has a real width instead of
    // shrink-wrapping to 0 around its absolutely-positioned child
    expect(cls(foot)).toContain("left-8");
    expect(cls(foot)).toMatch(/right-\[\d+px\]/);
  });

  it("keeps the scrubber clear of the read/edit telemetry", () => {
    // the scrubber's fill is near-opaque and sits at z16 against footRight's
    // z10 — spanning the full width would hide the counts outright
    const el = Bezel(PROPS) as React.ReactElement<any>;
    const layers = React.Children.toArray(el.props.children) as any[];
    const cls = (n: any) => String(n?.props?.className ?? "");
    const foot = layers.find((n) => cls(n).includes("z-[16]"));
    expect(cls(foot)).not.toContain("inset-x-8");
    const right = layers.find((n) => cls(n).includes("right-9 bottom-3"));
    const reserved = Number(/right-\[(\d+)px\]/.exec(cls(foot))![1]);
    expect(right).toBeDefined();
    expect(reserved).toBeGreaterThan(36); // clears footRight's own right-9
  });

  it("puts the scanline below the panel band, not above it (I6)", () => {
    const el = Bezel(PROPS) as React.ReactElement<any>;
    const layers = React.Children.toArray(el.props.children) as any[];
    const cls = (n: any) => String(n?.props?.className ?? "");
    const scan = layers.find((n) => cls(n).includes("hud-scan"));
    expect(cls(scan)).toContain("z-[15]");
    expect(cls(scan)).not.toContain("z-50");
  });
});
