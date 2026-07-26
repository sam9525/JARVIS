import { describe, it, expect } from "vitest";
import { brighten, COLORS } from "../../src/renderer/graph/graph-colors";

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
