import { describe, it, expect } from "vitest";
import { randomColor } from "../src/shared/random-color";

describe("randomColor", () => {
  it("always returns a #rrggbb hex string", () => {
    for (let i = 0; i < 200; i++) {
      expect(randomColor()).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});
