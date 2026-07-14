/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect } from "vitest";
import GraphSettingsPanel from "../src/renderer/GraphSettingsPanel";
import { defaultSettings } from "../src/shared/types";
import type { Settings } from "../src/shared/types";

function render(overrides: Partial<Settings> = {}) {
  const calls: {
    settings: Settings[];
    search: string[];
    closed: boolean;
    resets: number;
  } = {
    settings: [],
    search: [],
    closed: false,
    resets: 0,
  };
  const el = GraphSettingsPanel({
    settings: { ...defaultSettings(), ...overrides },
    search: "abc",
    onSearchChange: (s) => calls.search.push(s),
    onSettingsChange: (s) => calls.settings.push(s),
    onResetHighlights: () => {
      calls.resets++;
    },
    onClose: () => {
      calls.closed = true;
    },
  }) as any;
  return { el, calls };
}

describe("GraphSettingsPanel", () => {
  it("renders header + four sections, Forces collapsed by default", () => {
    const { el } = render();
    // [header, Filters, Groups, Display, Forces]
    expect(el.props.children).toHaveLength(5);
    const forces = el.props.children[4];
    expect(forces.type).toBe("details");
    expect(forces.props.open).toBeUndefined();
    expect(el.props.children[1].props.open).toBe(true); // Filters open
  });

  it("reset restores defaults but keeps dimensions and groups", () => {
    const groups = [{ query: "tech/", color: "#aa00ff" }];
    const { el, calls } = render({ showTags: false, dimensions: "3d", groups });
    const header = el.props.children[0];
    const resetBtn = header.props.children[0];
    resetBtn.props.onClick();
    expect(calls.settings[0]).toEqual({
      ...defaultSettings(),
      dimensions: "3d",
      groups,
    });
    expect(calls.search[0]).toBe("");
    expect(calls.resets).toBe(1);
  });

  it("close button calls onClose", () => {
    const { el, calls } = render();
    const closeBtn = el.props.children[0].props.children[1];
    closeBtn.props.onClick();
    expect(calls.closed).toBe(true);
  });

  it("new group gets a random hex color and empty query", () => {
    const { el, calls } = render();
    const groupsSection = el.props.children[2];
    // children: [summary, ...groupRows, newGroupButton]
    const kids = groupsSection.props.children;
    const newGroupBtn = kids[kids.length - 1];
    newGroupBtn.props.onClick();
    expect(calls.settings[0].groups).toHaveLength(1);
    expect(calls.settings[0].groups[0].query).toBe("");
    expect(calls.settings[0].groups[0].color).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("3D toggle switches dimensions", () => {
    const { el, calls } = render();
    // top-level children: [header, Filters, Groups, Display, Forces]
    const display = el.props.children[3];
    // Display children: [summary, 3D label, ...three Sliders]
    const label = display.props.children[1];
    const input = label.props.children[1]; // label children: ["3D", <input>]
    input.props.onChange({ target: { checked: true } });
    expect(calls.settings[0].dimensions).toBe("3d");
  });

  it("display sliders edit the active view only", () => {
    const { el, calls } = render({ dimensions: "3d" });
    const display = el.props.children[3];
    // Display children: [summary, 3D label, textFade, nodeSize, linkThickness]
    const nodeSizeSlider = display.props.children[3];
    nodeSizeSlider.props.onChange(2.5);
    expect(calls.settings[0].views["3d"].display.nodeSize).toBe(2.5);
    expect(calls.settings[0].views["2d"].display.nodeSize).toBe(1); // untouched
  });
});
