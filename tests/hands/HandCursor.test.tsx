import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import HandCursor from "../../src/renderer/hands/HandCursor";

describe("HandCursor", () => {
  it("positions itself in screen pixels", () => {
    const el = HandCursor({
      x: 420,
      y: 260,
      visible: true,
    }) as React.ReactElement;
    expect(el.props.style).toMatchObject({ left: 420, top: 260 });
  });

  it("renders nothing when not visible", () => {
    expect(HandCursor({ x: 0, y: 0, visible: false })).toBeNull();
  });

  it("never intercepts pointer events", () => {
    const html = renderToStaticMarkup(
      <HandCursor x={10} y={10} visible={true} />,
    );
    expect(html).toContain("pointer-events-none");
  });
});
