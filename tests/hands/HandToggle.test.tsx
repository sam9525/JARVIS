// @vitest-environment jsdom
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import HandToggle from "../../src/renderer/hands/HandToggle";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  act(() => {
    root = createRoot(container);
  });
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});
const render = (el: React.ReactElement) => act(() => root.render(el));
const button = () =>
  container.querySelector('[data-testid="hand-toggle"]') as HTMLElement;
const glyph = () =>
  container.querySelector('[data-testid="hand-glyph"]') as HTMLElement;

// The button carries a static `hover:border-accent` (matching the `↻`/`⚙`
// row), and that string contains "border-accent" as a substring — so a
// plain `className.toContain("border-accent")` check would pass in every
// state via the hover class alone and could never catch a wrong resting
// border. Split into exact class tokens and assert membership instead: only
// the literal `border-accent` token counts, not `hover:border-accent`. Keep
// this token-based — don't "simplify" back to `toContain` on the raw string.
const classTokens = (el: HTMLElement) => el.className.split(/\s+/);

const base = {
  cameraOn: false,
  armed: true,
  hasActions: true,
  error: null as string | null,
  onToggle: () => undefined,
};

describe("HandToggle", () => {
  it("camera off: plain", () => {
    render(<HandToggle {...base} />);
    expect(glyph().className).not.toContain("animate-pulse");
    expect(classTokens(button())).toContain("border-edge");
  });

  it("armed: pulsing glyph and accent border", () => {
    render(<HandToggle {...base} cameraOn />);
    expect(glyph().className).toContain("animate-pulse");
    expect(classTokens(button())).toContain("border-accent");
  });

  it("disarmed: pulse only — losing the border is the whole signal", () => {
    render(<HandToggle {...base} cameraOn armed={false} />);
    expect(glyph().className).toContain("animate-pulse");
    expect(classTokens(button())).not.toContain("border-accent");
  });

  it("no actions on this view: border without pulse, title says why", () => {
    render(<HandToggle {...base} cameraOn hasActions={false} />);
    expect(glyph().className).not.toContain("animate-pulse");
    expect(classTokens(button())).toContain("border-accent");
    expect(button().getAttribute("title")).toContain("no gestures");
  });

  it("tracker failure: warm border, message in title", () => {
    render(<HandToggle {...base} error="Camera permission denied" />);
    expect(classTokens(button())).toContain("border-warm");
    expect(button().getAttribute("title")).toContain(
      "Camera permission denied",
    );
  });

  it("click fires onToggle", () => {
    const onToggle = vi.fn();
    render(<HandToggle {...base} onToggle={onToggle} />);
    act(() => button().click());
    expect(onToggle).toHaveBeenCalled();
  });
});
