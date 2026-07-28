import { describe, it, expect } from "vitest";
import { sizeFromRect } from "../../src/renderer/graph/GraphSlot";

describe("sizeFromRect", () => {
  it("rounds fractional dimensions to whole pixels", () => {
    // subpixel values arrive on every frame of a CSS width transition;
    // rounding stops the canvas thrashing on <1px changes
    expect(sizeFromRect({ width: 799.6, height: 500.4 })).toEqual({
      width: 800,
      height: 500,
    });
  });

  it("passes integer dimensions through unchanged", () => {
    expect(sizeFromRect({ width: 1024, height: 768 })).toEqual({
      width: 1024,
      height: 768,
    });
  });

  it("handles a zero-size (unmeasured) element", () => {
    expect(sizeFromRect({ width: 0, height: 0 })).toEqual({
      width: 0,
      height: 0,
    });
  });
});
