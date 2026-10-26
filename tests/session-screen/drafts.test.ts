import { describe, expect, it, vi } from "vitest";
import {
  appendDraft,
  getDraft,
  onDraft,
  setDraft,
} from "../../src/renderer/session-screen/drafts";

describe("drafts", () => {
  it("append joins with a space", () => {
    expect(getDraft("d-empty")).toBe("");
    appendDraft("d-join", "one");
    appendDraft("d-join", "two");
    expect(getDraft("d-join")).toBe("one two");
  });

  it("notifies on change", () => {
    const fn = vi.fn();
    const off = onDraft(fn);
    setDraft("d-notify", "x");
    expect(fn).toHaveBeenCalledWith("d-notify");
    off();
    setDraft("d-notify", "y");
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
