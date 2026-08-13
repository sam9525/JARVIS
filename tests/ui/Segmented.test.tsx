import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import Segmented from "../../src/renderer/ui/Segmented";
import { LBL_CY, LBL_DIM } from "../../src/renderer/ui/hud";

const OPTIONS = [
  { value: "cards" as const, label: "Cards" },
  { value: "fleet" as const, label: "Fleet" },
];

describe("Segmented", () => {
  it("renders every option label", () => {
    const html = renderToStaticMarkup(
      <Segmented options={OPTIONS} value="cards" onChange={vi.fn()} />,
    );
    expect(html).toContain("Cards");
    expect(html).toContain("Fleet");
  });

  it("marks only the selected option active, with no pill radius", () => {
    const el = Segmented({
      options: OPTIONS,
      value: "cards",
      onChange: vi.fn(),
    }) as React.ReactElement;
    const [cards, fleet] = el.props.children;
    expect(cards.props.className).toContain("bg-accent/15");
    expect(fleet.props.className).not.toContain("bg-accent/15");
    expect(el.props.className).not.toMatch(/rounded/);
  });

  it("labels are uppercase HUD micro-type", () => {
    const el = Segmented({
      options: OPTIONS,
      value: "cards",
      onChange: vi.fn(),
    }) as React.ReactElement;
    expect(el.props.children[0].props.className).toContain("uppercase");
  });

  it("composes its labels from the shared vocabulary, not a hand copy", () => {
    const el = Segmented({
      options: OPTIONS,
      value: "cards",
      onChange: vi.fn(),
    }) as React.ReactElement;
    const [active, inactive] = el.props.children;
    expect(active.props.className).toContain(LBL_CY);
    expect(inactive.props.className).toContain(LBL_DIM);
    // pins the tracking value: a hand-rolled copy drifted to 0.2em once
    expect(active.props.className).toContain("tracking-[0.22em]");
  });

  it("reports the clicked option's value", () => {
    const onChange = vi.fn();
    const el = Segmented({
      options: OPTIONS,
      value: "cards",
      onChange,
    }) as React.ReactElement;
    el.props.children[1].props.onClick();
    expect(onChange).toHaveBeenCalledWith("fleet");
  });
});
