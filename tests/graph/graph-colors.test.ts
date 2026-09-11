import { describe, it, expect } from "vitest";
import {
  brighten,
  COLORS,
  RADIUS_COLOR,
  radiusColor,
} from "../../src/renderer/graph/graph-colors";

describe("brighten", () => {
  it("returns the input untouched at zero heat", () => {
    // the guarantee that a cold graph renders pixel-identical to before
    expect(brighten("#61afef", 0)).toBe("#61afef");
    expect(brighten(COLORS.modified, 0)).toBe(COLORS.modified);
  });

  it("mixes toward white at full heat", () => {
    expect(brighten("#000000", 1)).toBe("#8c8c8c"); // 0 + 255*0.55
  });

  it("leaves white alone — nothing to mix toward", () => {
    expect(brighten("#ffffff", 1)).toBe("#ffffff");
  });

  it("pads short channel values so the hex stays 6 digits", () => {
    expect(brighten("#000001", 0.02)).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("passes through anything that isn't a 6-digit hex", () => {
    // group colours come from user settings; a malformed one must not crash paint
    expect(brighten("rebeccapurple", 1)).toBe("rebeccapurple");
    expect(brighten("#fff", 1)).toBe("#fff");
  });
});

describe("radiusColor", () => {
  it("returns the full violet at the target", () => {
    expect(radiusColor(0, "#000000")).toBe(RADIUS_COLOR);
  });

  it("blends toward the base colour as depth grows", () => {
    const d1 = radiusColor(1, "#000000");
    const d2 = radiusColor(2, "#000000");
    expect(d1).not.toBe(RADIUS_COLOR);
    expect(d2).not.toBe(d1);
    // darker each hop, since the base here is black
    expect(parseInt(d2.slice(1), 16)).toBeLessThan(parseInt(d1.slice(1), 16));
  });

  it("clamps every depth past 2 to the same tier", () => {
    expect(radiusColor(5, "#123456")).toBe(radiusColor(2, "#123456"));
  });

  it("always returns six hex digits, never hsl", () => {
    for (const d of [0, 1, 2, 9])
      expect(radiusColor(d, "#4a5568")).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("survives a base colour it cannot parse", () => {
    expect(radiusColor(1, "not a colour")).toBe(RADIUS_COLOR);
  });

  it("stays clear of the reserved cyan and amber bands", () => {
    // 270° violet: nowhere near cyan 172-202 or amber 10-40
    expect(RADIUS_COLOR).toBe("#c084fc");
  });
});
