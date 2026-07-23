import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import GraphLevelToggle from "../src/renderer/GraphLevelToggle";

describe("GraphLevelToggle", () => {
  it("renders nothing for a vault workspace", () => {
    const html = renderToStaticMarkup(
      <GraphLevelToggle kind="vault" value="file" onChange={() => {}} />,
    );
    expect(html).toBe("");
  });

  it("shows Files and Symbols for a code workspace and reports a change", () => {
    const onChange = vi.fn();
    const el = GraphLevelToggle({
      kind: "code",
      value: "file",
      onChange,
    }) as React.ReactElement;
    expect(el).not.toBeNull();

    const html = renderToStaticMarkup(
      <GraphLevelToggle kind="code" value="file" onChange={onChange} />,
    );
    expect(html).toContain("Files");
    expect(html).toContain("Symbols");

    const buttons = el.props.children;
    const symbolsBtn = buttons.find(
      (b: any) => b.props && b.props.children === "Symbols",
    );
    expect(symbolsBtn).toBeDefined();
    symbolsBtn.props.onClick();
    expect(onChange).toHaveBeenCalledWith("symbol");
  });
});
