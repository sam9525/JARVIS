import { describe, expect, it, vi } from "vitest";
import {
  getViewMode,
  onViewMode,
  setViewMode,
  wasAutoFlipped,
} from "../../src/renderer/session-screen/view-mode";

describe("view mode", () => {
  it("defaults to screen", () => {
    expect(getViewMode("vm-default")).toBe("screen");
    expect(wasAutoFlipped("vm-default")).toBe(false);
  });

  it("notifies on change", () => {
    const fn = vi.fn();
    const off = onViewMode(fn);
    setViewMode("vm-notify", "raw");
    expect(fn).toHaveBeenCalledWith("vm-notify");
    expect(getViewMode("vm-notify")).toBe("raw");
    off();
    setViewMode("vm-notify", "screen");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("remembers an auto flip", () => {
    setViewMode("vm-auto", "raw", true);
    expect(wasAutoFlipped("vm-auto")).toBe(true);
    setViewMode("vm-auto", "screen");
    expect(wasAutoFlipped("vm-auto")).toBe(false);
  });
});
