import { describe, expect, it } from "vitest";
import {
  historyEntries,
  NOT_BROWSING,
  onFirstLine,
  onLastLine,
  stepHistory,
} from "../../src/renderer/session-screen/prompt-history";
import type { ScreenItem } from "../../src/renderer/session-screen/screen-state";

const E = ["one", "two", "three"];

describe("prompt history", () => {
  it("ignores task items", () => {
    expect(
      historyEntries([
        { kind: "task", id: "t", summary: "s", failed: false, full: "f" },
      ]),
    ).toEqual([]);
  });

  it("collapses consecutive duplicate prompts", () => {
    const p = (id: string, text: string): ScreenItem => ({
      kind: "prompt",
      id,
      text,
    });
    expect(
      historyEntries([p("1", "a"), p("2", "a"), p("3", "b"), p("4", "a")]),
    ).toEqual(["a", "b", "a"]);
  });
  it("first Up recalls the newest entry and saves the draft", () => {
    expect(stepHistory(E, NOT_BROWSING, "half typed", "up")).toEqual({
      state: { pos: 2, saved: "half typed" },
      text: "three",
    });
  });
  it("Up at the oldest entry does not move", () => {
    expect(stepHistory(E, { pos: 0, saved: "" }, "one", "up")).toBeNull();
  });
  it("Down past the newest restores the saved draft", () => {
    expect(
      stepHistory(E, { pos: 2, saved: "half typed" }, "three", "down"),
    ).toEqual({
      state: NOT_BROWSING,
      text: "half typed",
    });
  });
  it("Down when not browsing does not move", () => {
    expect(stepHistory(E, NOT_BROWSING, "x", "down")).toBeNull();
  });
  it("empty history does not move", () => {
    expect(stepHistory([], NOT_BROWSING, "x", "up")).toBeNull();
  });
  it("knows the caret's line", () => {
    expect(onFirstLine("a\nb", 1)).toBe(true);
    expect(onFirstLine("a\nb", 3)).toBe(false);
    expect(onLastLine("a\nb", 3)).toBe(true);
    expect(onLastLine("a\nb", 1)).toBe(false);
  });
});
