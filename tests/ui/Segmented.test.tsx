import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import Segmented from "../../src/renderer/ui/Segmented";

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

  it("marks only the selected option active", () => {
    const el = Segmented({
      options: OPTIONS,
      value: "cards",
      onChange: vi.fn(),
    }) as React.ReactElement;
    const [cards, fleet] = el.props.children;
    expect(cards.props.className).toContain("bg-edge");
    expect(fleet.props.className).not.toContain("bg-edge");
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
