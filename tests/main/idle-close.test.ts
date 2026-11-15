import { describe, it, expect } from "vitest";
import { closeQuietSessions, idleCloseKeys } from "../../src/main/idle-close";
import type { SessionInfo } from "../../src/main/sessions";
import type { Workspace } from "../../src/shared/types";

const MIN = 60 * 1000;

function deps(
  silentMs: Record<string, number>,
  opts: { dirty?: string[]; refuses?: string[] } = {},
) {
  const asked: string[] = [];
  return {
    asked,
    d: {
      keys: () => Object.keys(silentMs),
      msSinceOutput: (k: string) => silentMs[k],
      keepsWork: async (k: string) => (opts.dirty ?? []).includes(k),
      closeIfIdle: async (k: string) => {
        asked.push(k);
        return !(opts.refuses ?? []).includes(k);
      },
    },
  };
}

describe("closeQuietSessions", () => {
  it("closes a session silent for 30 minutes and leaves a newer one", async () => {
    const { d } = deps({ old: 30 * MIN, fresh: 29 * MIN });
    expect(await closeQuietSessions(d, 30 * MIN)).toEqual(["old"]);
  });

  it("keeps a worktree that holds work without asking to close it", async () => {
    const { d, asked } = deps({ wt: 40 * MIN }, { dirty: ["wt"] });
    expect(await closeQuietSessions(d, 30 * MIN)).toEqual([]);
    expect(asked).toEqual([]);
  });

  it("reports only the closes closeIfIdle accepted (a draft refuses)", async () => {
    const { d } = deps(
      { a: 40 * MIN, drafted: 40 * MIN },
      { refuses: ["drafted"] },
    );
    expect(await closeQuietSessions(d, 30 * MIN)).toEqual(["a"]);
  });
});

function session(key: string, delegated: boolean): SessionInfo {
  return {
    key,
    workspaceId: "w",
    label: key,
    cwd: "/w",
    worktree: false,
    delegated,
  };
}

function workspace(isSelf: boolean): Workspace {
  return { id: "w", isSelf } as Workspace;
}

describe("idleCloseKeys", () => {
  it("offers only delegated sessions", () => {
    const sessions = [session("d", true), session("h", false)];
    expect(
      idleCloseKeys(
        [workspace(false)],
        () => sessions,
        () => true,
        () => false,
      ),
    ).toEqual(["d"]);
  });

  it("skips a delegated session with no terminal", () => {
    expect(
      idleCloseKeys(
        [workspace(false)],
        () => [session("d", true)],
        () => false,
        () => false,
      ),
    ).toEqual([]);
  });

  it("leaves out a session whose delivered prompt has not run", () => {
    const sessions = [session("a", true), session("b", true)];
    expect(
      idleCloseKeys(
        [workspace(false)],
        () => sessions,
        () => true,
        (key) => key === "a",
      ),
    ).toEqual(["b"]);
  });

  it("never offers the main agent's sessions", () => {
    expect(
      idleCloseKeys(
        [workspace(true)],
        () => [session("d", true)],
        () => true,
        () => false,
      ),
    ).toEqual([]);
  });
});
