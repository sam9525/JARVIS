import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import HomeViewToggle from "../src/renderer/HomeViewToggle";

describe("HomeViewToggle", () => {
  it("renders Cards and Fleet options and reports changes", () => {
    const onChange = vi.fn();
    const html = renderToStaticMarkup(
      <HomeViewToggle value="cards" onChange={onChange} />,
    );
    expect(html).toContain("Cards");
    expect(html).toContain("Fleet");
    expect(html).toContain('data-testid="home-view-cards"');
    expect(html).toContain('data-testid="home-view-fleet"');

    const el = HomeViewToggle({
      value: "cards",
      onChange,
    }) as React.ReactElement;
    expect(el).not.toBeNull();

    const buttons = el.props.children;
    const fleetBtn = buttons.find(
      (b: { props?: { children?: string; onClick?: () => void } }) =>
        b.props && b.props.children === "Fleet",
    );
    expect(fleetBtn).toBeDefined();
    fleetBtn.props.onClick();
    expect(onChange).toHaveBeenCalledWith("fleet");
  });
});
