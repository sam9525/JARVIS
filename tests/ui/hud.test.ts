import { describe, expect, it } from "vitest";
import {
  FRAME,
  GLASS,
  GLASS_UN,
  LBL,
  panelClass,
  pipClass,
} from "../../src/renderer/ui/hud";

describe("hud vocabulary", () => {
  it("never rounds a frame — the HUD is corner brackets, not pills", () => {
    expect(FRAME).not.toMatch(/rounded/);
    expect(GLASS).not.toMatch(/rounded/);
  });

  it("labels are uppercase and tracked", () => {
    expect(LBL).toContain("uppercase");
    expect(LBL).toContain("tracking-");
  });

  it("a focused panel is more opaque than an unfocused one", () => {
    expect(panelClass(true)).toContain(GLASS);
    expect(panelClass(false)).toContain(GLASS_UN);
    expect(panelClass(true)).not.toBe(panelClass(false));
  });

  it("only the waiting pip takes the warm colour", () => {
    expect(pipClass("waiting", false)).toContain("warm");
    expect(pipClass("running", false)).not.toContain("warm");
    expect(pipClass("idle", false)).not.toContain("warm");
  });

  it("an active pip reads accent at rest even when its session is idle", () => {
    // hover: variants mention accent on every pip — the question is what the
    // pip looks like when nobody is pointing at it
    const resting = (c: string) =>
      c
        .split(" ")
        .filter((t) => !t.startsWith("hover:"))
        .join(" ");
    expect(resting(pipClass("idle", true))).toContain("accent");
    expect(resting(pipClass("idle", false))).not.toContain("accent");
  });
});
