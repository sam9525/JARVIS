import { describe, it, expect } from "vitest";
import { endId } from "../../src/renderer/graph/link-ends";

describe("endId", () => {
  it("passes through a raw id, as links arrive before the graph binds", () => {
    expect(endId("physics/a")).toBe("physics/a");
  });

  it("reads .id once force-graph has swapped in node objects", () => {
    expect(endId({ id: "physics/a", x: 1, y: 2 })).toBe("physics/a");
  });

  it("stringifies numeric ids from either shape", () => {
    expect(endId(42)).toBe("42");
    expect(endId({ id: 42 })).toBe("42");
  });

  it("does not throw on a missing end", () => {
    expect(endId(undefined)).toBe("undefined");
  });
});
