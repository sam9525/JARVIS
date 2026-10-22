import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  createPreviewOpener,
  isEditOf,
  PREVIEW_QUIET_MS,
} from "../../src/renderer/preview/preview-opener";
import type { ToolEvent } from "../../src/shared/types";

const ev = (over: Partial<ToolEvent>): ToolEvent => ({
  sessionId: "s1",
  workspaceId: "w1",
  phase: "pre",
  tool: "Read",
  nodeIds: [],
  ts: 0,
  ...over,
});

describe("preview-opener", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("opens the LAST read file once reads go quiet", () => {
    const opened: (string | null)[] = [];
    const onEvent = createPreviewOpener((id) => opened.push(id));
    onEvent(ev({ nodeIds: ["a"] }));
    vi.advanceTimersByTime(PREVIEW_QUIET_MS - 500);
    onEvent(ev({ nodeIds: ["b"] })); // still reading — timer restarts on b
    vi.advanceTimersByTime(PREVIEW_QUIET_MS - 500);
    expect(opened).toEqual([]); // never opened mid-stream
    vi.advanceTimersByTime(500);
    expect(opened).toEqual(["b"]);
  });

  it("a new prompt cancels the pending open and closes the preview", () => {
    const opened: (string | null)[] = [];
    const onEvent = createPreviewOpener((id) => opened.push(id));
    onEvent(ev({ nodeIds: ["a"] }));
    onEvent(ev({ tool: "Prompt" }));
    expect(opened).toEqual([null]); // close whatever was open
    vi.advanceTimersByTime(PREVIEW_QUIET_MS * 2);
    expect(opened).toEqual([null]); // pending open never fires
  });

  it("other tool events neither schedule nor cancel", () => {
    const opened: (string | null)[] = [];
    const onEvent = createPreviewOpener((id) => opened.push(id));
    onEvent(ev({ nodeIds: ["a"] }));
    onEvent(ev({ tool: "Grep", pattern: "x" }));
    vi.advanceTimersByTime(PREVIEW_QUIET_MS);
    expect(opened).toEqual(["a"]);
  });

  it("cancel() drops a pending open (workspace switch)", () => {
    vi.useFakeTimers();
    const open = vi.fn();
    const opener = createPreviewOpener(open);
    opener({
      sessionId: "s",
      workspaceId: "w1",
      phase: "pre",
      tool: "Read",
      nodeIds: ["a"],
      ts: 0,
    });
    opener.cancel();
    vi.advanceTimersByTime(10_000);
    expect(open).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});

describe("isEditOf", () => {
  it("matches a finished Edit or Write of the previewed file", () => {
    expect(
      isEditOf(ev({ phase: "post", tool: "Edit", nodeIds: ["a"] }), "a"),
    ).toBe(true);
    expect(
      isEditOf(ev({ phase: "post", tool: "Write", nodeIds: ["a"] }), "a"),
    ).toBe(true);
  });

  // the pre event fires before the file is written, so a re-read there
  // would show the old text
  it("ignores the pre phase, other files, reads and a closed preview", () => {
    expect(
      isEditOf(ev({ phase: "pre", tool: "Edit", nodeIds: ["a"] }), "a"),
    ).toBe(false);
    expect(
      isEditOf(ev({ phase: "post", tool: "Edit", nodeIds: ["b"] }), "a"),
    ).toBe(false);
    expect(
      isEditOf(ev({ phase: "post", tool: "Read", nodeIds: ["a"] }), "a"),
    ).toBe(false);
    expect(
      isEditOf(ev({ phase: "post", tool: "Edit", nodeIds: ["a"] }), null),
    ).toBe(false);
  });
});
