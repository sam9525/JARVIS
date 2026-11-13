import { describe, expect, it } from "vitest";
import { hasLiveSession } from "../../src/renderer/terminal/terminal-fold";
import type { SessionStatus, WorkspaceStatus } from "../../src/shared/types";

const s = (
  live: boolean,
  extra: Partial<SessionStatus> = {},
): SessionStatus => ({
  key: "main",
  label: "main",
  kind: "idle",
  live,
  call: "",
  since: 0,
  worktree: false,
  ...extra,
});

const ws = (
  workspaceId: string,
  sessions: SessionStatus[],
): WorkspaceStatus => ({
  workspaceId,
  kind: "idle",
  call: "",
  since: 0,
  reads: 0,
  edits: 0,
  sessions,
});

describe("hasLiveSession", () => {
  it("is live when any session of the workspace is live, worktree included", () => {
    expect(
      hasLiveSession([ws("a", [s(false), s(true, { worktree: true })])], "a"),
    ).toBe(true);
  });

  it("is not live with no live session, or an unknown workspace", () => {
    expect(hasLiveSession([ws("a", [s(false)])], "a")).toBe(false);
    expect(hasLiveSession([ws("a", [s(true)])], "b")).toBe(false);
  });
});
