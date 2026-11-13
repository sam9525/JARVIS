import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  closedPath,
  forgetClosed,
  MAX_CLOSED_PER_WORKSPACE,
  readClosed,
  recordClosed,
  writeClosed,
  type ClosedSession,
} from "../../src/main/closed-sessions";

const SID = "0b5e6c1a-7f3d-4e2b-9a8c-1d2e3f4a5b6c";
const entry = (over: Partial<ClosedSession> = {}): ClosedSession => ({
  workspaceId: "d:/aero",
  label: "main",
  sessionId: SID,
  cwd: "d:/aero",
  topic: "codex",
  closedAt: 1,
  ...over,
});

describe("recordClosed", () => {
  it("replaces an older close of the same label", () => {
    const list = recordClosed(
      [entry({ topic: "old" })],
      entry({ closedAt: 2 }),
    );
    expect(list).toEqual([entry({ closedAt: 2 })]);
  });

  it("keeps only the newest closes of one workspace", () => {
    let list: ClosedSession[] = [entry({ workspaceId: "d:/other" })];
    for (let i = 1; i <= MAX_CLOSED_PER_WORKSPACE + 2; i++)
      list = recordClosed(list, entry({ label: String(i), closedAt: i }));
    const mine = list.filter((c) => c.workspaceId === "d:/aero");
    expect(mine.map((c) => c.label)).toEqual(["6", "5", "4", "3"]);
    expect(list.some((c) => c.workspaceId === "d:/other")).toBe(true);
  });
});

describe("forgetClosed", () => {
  it("drops only that workspace's resumed conversation", () => {
    const list = [
      entry(),
      entry({ label: "2", sessionId: "s2" }),
      entry({ workspaceId: "x" }),
    ];
    expect(forgetClosed(list, "d:/aero", SID)).toEqual([
      entry({ label: "2", sessionId: "s2" }),
      entry({ workspaceId: "x" }),
    ]);
  });

  it("forgets only the resumed conversation", () => {
    const list = [
      entry({ label: "auto", sessionId: "s2" }),
      entry({ label: "other", sessionId: "s3" }),
    ];
    expect(forgetClosed(list, "d:/aero", "s1")).toEqual(list);
    expect(forgetClosed(list, "d:/aero", "s2")).toEqual([
      entry({ label: "other", sessionId: "s3" }),
    ]);
  });
});

describe("readClosed / writeClosed", () => {
  it("round-trips, and drops a malformed or unsafe entry", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "jarvis-closed-"));
    writeClosed(dir, [entry()]);
    expect(readClosed(dir)).toEqual([entry()]);
    writeFileSync(
      closedPath(dir),
      JSON.stringify([
        entry(),
        { label: "x" },
        entry({ sessionId: "../evil" }),
      ]),
    );
    expect(readClosed(dir)).toEqual([entry()]);
  });

  it("reads a missing or corrupt file as empty", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "jarvis-closed-"));
    expect(readClosed(dir)).toEqual([]);
    writeFileSync(closedPath(dir), "{not json");
    expect(readClosed(dir)).toEqual([]);
  });
});
