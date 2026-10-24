import { describe, expect, it } from "vitest";
import os from "node:os";
import path from "node:path";
import {
  RESUME_WINDOW_MS,
  sessionsToResume,
} from "../../src/main/session-restore";

const SID = "0b5e6c1a-7f3d-4e2b-9a8c-1d2e3f4a5b6c";
const NOW = 1_800_000_000_000;
// a folder that exists, standing in for every workspace root
const ROOT = os.tmpdir();
const MISSING = path.join(ROOT, "jarvis-no-such-folder-9f2c");
const rootOf = (id: string) => (id === "gone" ? undefined : ROOT);
const resumed = { repo: { sessionId: SID, label: "main", cwd: ROOT } };
const saved = (closedAt: number) => ({ closedAt, sessions: resumed });

describe("sessionsToResume", () => {
  it("resumes inside the window, up to the hour itself", () => {
    expect(sessionsToResume(saved(NOW - 5 * 60_000), NOW, rootOf)).toEqual(
      resumed,
    );
    expect(
      sessionsToResume(saved(NOW - RESUME_WINDOW_MS), NOW, rootOf),
    ).toEqual(resumed);
  });

  it("starts fresh just outside the window", () => {
    expect(
      sessionsToResume(saved(NOW - RESUME_WINDOW_MS - 1), NOW, rootOf),
    ).toEqual({});
  });

  it("starts fresh with no stored state", () => {
    expect(sessionsToResume(null, NOW, rootOf)).toEqual({});
    expect(sessionsToResume({ sessions: resumed }, NOW, rootOf)).toEqual({});
  });

  it("does not trust a close time in the future", () => {
    expect(sessionsToResume(saved(NOW + 60_000), NOW, rootOf)).toEqual({});
  });

  it("drops an id that is not a UUID", () => {
    const entry = (sessionId: unknown) => ({
      sessionId,
      label: "1",
      cwd: ROOT,
    });
    const s = {
      closedAt: NOW,
      sessions: { a: entry("x & calc"), b: entry(SID), c: entry(3) },
    };
    expect(sessionsToResume(s, NOW, rootOf)).toEqual({ b: entry(SID) });
  });

  it("round-trips a worktree session under its own key", () => {
    const s = {
      closedAt: NOW,
      sessions: { "d:/r#2": { sessionId: SID, label: "2", cwd: ROOT } },
    };
    expect(sessionsToResume(s, NOW, rootOf)).toEqual(s.sessions);
  });

  it("reads an old workspace → session id entry as that workspace's main session", () => {
    const s = { closedAt: NOW, sessions: { "d:/r": SID, gone: SID } };
    expect(sessionsToResume(s, NOW, rootOf)).toEqual({
      "d:/r": { sessionId: SID, label: "main", cwd: ROOT },
    });
  });

  it("drops a session whose folder no longer exists", () => {
    const s = {
      closedAt: NOW,
      sessions: {
        "d:/r#1": { sessionId: SID, label: "1", cwd: MISSING },
        "d:/r#2": { sessionId: SID, label: "2" },
      },
    };
    expect(sessionsToResume(s, NOW, rootOf)).toEqual({});
  });
});
