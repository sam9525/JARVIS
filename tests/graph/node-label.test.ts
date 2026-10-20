import { describe, it, expect } from "vitest";
import {
  nodeLabelColor,
  nodeLabelText,
} from "../../src/renderer/graph/node-label";
import { COLORS } from "../../src/renderer/graph/graph-colors";

describe("nodeLabelText", () => {
  it("renders tags as #name", () => {
    expect(nodeLabelText("tag:todo", "tag")).toBe("#todo");
  });
  it("renders notes as their filename", () => {
    expect(nodeLabelText("physics/wiki/overview", "note")).toBe("overview");
  });
  it("keeps a root-level note id as-is", () => {
    expect(nodeLabelText("stray", "note")).toBe("stray");
  });
});

describe("nodeLabelColor", () => {
  it("wears the modified ring's colour on a modified node", () => {
    expect(nodeLabelColor("modified")).toBe(COLORS.modified);
  });
  it("keeps the plain label colour for a read, impact or quiet node", () => {
    for (const d of ["ring", "impact", null] as const) {
      expect(nodeLabelColor(d)).toBe(COLORS.label);
    }
  });
});
