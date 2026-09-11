// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/no-explicit-any */
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import Segmented from "../../src/renderer/ui/Segmented";
import { LBL_CY, LBL_DIM } from "../../src/renderer/ui/hud";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const OPTIONS = [
  { value: "cards" as const, label: "Cards" },
  { value: "fleet" as const, label: "Fleet" },
];

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

const render = (value: "cards" | "fleet", onChange = vi.fn()) => {
  act(() => {
    root.render(
      <Segmented options={OPTIONS} value={value} onChange={onChange} />,
    );
  });
  return onChange;
};

const buttons = () => Array.from(container.querySelectorAll("button"));

describe("Segmented", () => {
  it("renders every option label", () => {
    render("cards");
    expect(buttons().map((b) => b.textContent)).toEqual(["Cards", "Fleet"]);
  });

  it("marks only the selected option, with no pill radius", () => {
    render("cards");
    const [cards, fleet] = buttons();
    expect(cards.getAttribute("data-on")).toBe("1");
    expect(fleet.getAttribute("data-on")).toBeNull();
    expect(container.firstElementChild!.className).not.toMatch(/rounded/);
  });

  it("composes its labels from the shared vocabulary, not a hand copy", () => {
    render("cards");
    const [cards, fleet] = buttons();
    expect(cards.className).toContain(LBL_CY);
    expect(fleet.className).toContain(LBL_DIM);
    // pins the tracking value: a hand-rolled copy drifted to 0.2em once
    expect(cards.className).toContain("tracking-[0.22em]");
    expect(cards.className).toContain("uppercase");
  });

  it("reports the clicked option's value", () => {
    const onChange = render("cards");
    act(() => buttons()[1].click());
    expect(onChange).toHaveBeenCalledWith("fleet");
  });

  // the fill is one element that travels, not a background that jumps between
  // two — that is the whole reason the widths are measured
  it("carries the fill on a single travelling element", () => {
    render("cards");
    expect(
      container.querySelectorAll('[data-testid="segmented-fill"]'),
    ).toHaveLength(1);
    for (const b of buttons())
      expect(b.className).not.toContain("bg-accent/15");
  });

  it("moves the fill to the option that became active", () => {
    // jsdom reports 0 for every offset, so drive the measurement by hand
    Object.defineProperty(HTMLElement.prototype, "offsetLeft", {
      configurable: true,
      get(this: HTMLElement) {
        return this.getAttribute("data-on") ? 40 : 0;
      },
    });
    Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
      configurable: true,
      get: () => 55,
    });
    render("fleet");
    const fill = container.querySelector(
      '[data-testid="segmented-fill"]',
    ) as HTMLElement;
    expect(fill.style.left).toBe("40px");
    expect(fill.style.width).toBe("55px");
  });

  it("renders on the server, where nothing can be measured", () => {
    const html = renderToStaticMarkup(
      <Segmented options={OPTIONS} value="cards" onChange={vi.fn()} />,
    );
    expect(html).toContain("Cards");
    expect(html).not.toContain("segmented-fill");
  });
});
