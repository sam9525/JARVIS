import { describe, it, expect } from "vitest";
import { nodeLabelText } from "../src/renderer/node-label";

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
