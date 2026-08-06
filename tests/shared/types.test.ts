import { describe, it, expect } from "vitest";
import { defaultSettings, groupsFor, NO_GROUPS } from "../../src/shared/types";
import type { Settings } from "../../src/shared/types";

describe("groupsFor", () => {
  it("returns the stable NO_GROUPS identity for a workspace with no groups", () => {
    const settings = defaultSettings();
    const a = groupsFor(settings, "ws1");
    const b = groupsFor(settings, "ws1");
    expect(a).toBe(b);
    expect(a).toBe(NO_GROUPS);
  });

  it("still returns a workspace's own groups array when one exists", () => {
    const own = [{ query: "physics/", color: "#61afef" }];
    const settings: Settings = {
      ...defaultSettings(),
      groups: { ws1: own },
    };
    expect(groupsFor(settings, "ws1")).toBe(own);
  });
});
