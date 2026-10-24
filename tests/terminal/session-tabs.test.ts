import { describe, expect, it } from "vitest";
import {
  homeTabs,
  pickTab,
  projectTabs,
  pruneSelections,
} from "../../src/renderer/terminal/session-tabs";
import type {
  SessionStatus,
  Workspace,
  WorkspaceStatus,
} from "../../src/shared/types";

const SELF: Workspace = {
  id: "self",
  name: "Main agent",
  rootPath: "/u/main-agent",
  kind: "vault",
  sourceId: "unknown",
  isSelf: true,
};
const SCRATCH: Workspace = {
  id: "scr",
  name: "Scratch",
  rootPath: "/u/scratch",
  kind: "vault",
  sourceId: "unknown",
  isScratch: true,
};
const REPO: Workspace = {
  id: "repo",
  name: "Repo",
  rootPath: "/r",
  kind: "code",
  sourceId: "gitnexus",
};

const session = (
  key: string,
  label: string,
  extra: Partial<SessionStatus> = {},
): SessionStatus => ({
  key,
  label,
  kind: "idle",
  live: true,
  call: "",
  since: 0,
  worktree: false,
  ...extra,
});

const row = (
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

describe("homeTabs", () => {
  it("is the main agent alone while scratch has no live session", () => {
    const tabs = homeTabs(SELF, SCRATCH, [
      row("self", [session("self", "main", { kind: "working" })]),
      row("scr", [session("scr", "main", { live: false, kind: "none" })]),
    ]);
    expect(tabs.map((t) => t.label)).toEqual(["MAIN AGENT"]);
    expect(tabs[0]).toMatchObject({
      key: "self",
      workspaceId: "self",
      kind: "working",
      main: true,
    });
  });

  it("names a single live scratch session SCRATCH", () => {
    const tabs = homeTabs(SELF, SCRATCH, [row("scr", [session("scr#1", "1")])]);
    expect(tabs.map((t) => t.label)).toEqual(["MAIN AGENT", "SCRATCH"]);
    expect(tabs[1]).toMatchObject({ key: "scr#1", workspaceId: "scr" });
    expect(tabs[1].main).toBeFalsy();
  });

  it("numbers several by position, not by label", () => {
    const tabs = homeTabs(SELF, SCRATCH, [
      row("scr", [
        session("scr#2", "2"),
        session("scr#3", "3", { live: false }),
        session("scr#5", "5"),
      ]),
    ]);
    expect(tabs.map((t) => t.label)).toEqual([
      "MAIN AGENT",
      "SCRATCH 1",
      "SCRATCH 2",
    ]);
    expect(tabs.map((t) => t.key)).toEqual(["self", "scr#2", "scr#5"]);
  });

  it("works without a scratch workspace", () => {
    expect(homeTabs(SELF, undefined, []).map((t) => t.label)).toEqual([
      "MAIN AGENT",
    ]);
  });
});

describe("projectTabs", () => {
  it("is the single main tab while nothing is live", () => {
    const tabs = projectTabs(REPO, [
      row("repo", [session("repo", "main", { live: false, kind: "crashed" })]),
    ]);
    expect(tabs).toEqual([
      {
        key: "repo",
        label: "main",
        kind: "crashed",
        workspaceId: "repo",
        main: true,
      },
    ]);
    expect(projectTabs(REPO, []).map((t) => t.key)).toEqual(["repo"]);
  });

  it("lists the live sessions by label", () => {
    const tabs = projectTabs(REPO, [
      row("repo", [
        session("repo", "main"),
        session("repo#1", "1", { worktree: true, kind: "working" }),
        session("repo#2", "2", { live: false }),
      ]),
    ]);
    expect(tabs.map((t) => [t.key, t.label, t.kind])).toEqual([
      ["repo", "main", "idle"],
      ["repo#1", "1", "working"],
    ]);
  });

  it("keeps the main tab even when only other sessions are live", () => {
    const tabs = projectTabs(REPO, [
      row("repo", [
        session("repo", "main", { live: false, kind: "none" }),
        session("repo#1", "1", { worktree: true }),
      ]),
    ]);
    expect(tabs.map((t) => t.key)).toEqual(["repo", "repo#1"]);
  });

  it("hints a shared folder on a code session without a worktree", () => {
    const tabs = projectTabs(REPO, [
      row("repo", [session("repo", "main"), session("repo#1", "1")]),
    ]);
    expect(tabs[0].hint).toBeUndefined();
    expect(tabs[1].hint).toBe("shared folder");
    const vault = { ...REPO, id: "v", kind: "vault" as const };
    expect(
      projectTabs(vault, [row("v", [session("v#1", "1")])])[1].hint,
    ).toBeUndefined();
  });
});

describe("pickTab", () => {
  const tabs = projectTabs(REPO, [
    row("repo", [session("repo", "main"), session("repo#1", "1")]),
  ]);

  it("keeps a selection that is still a tab", () => {
    expect(pickTab(tabs, "repo#1").key).toBe("repo#1");
  });

  it("falls back to the first tab when the selected session ended", () => {
    expect(pickTab(tabs, "repo#9").key).toBe("repo");
    expect(pickTab(tabs, undefined).key).toBe("repo");
  });
});

describe("pruneSelections", () => {
  const withOne = projectTabs(REPO, [
    row("repo", [session("repo", "main"), session("repo#1", "1")]),
  ]);
  const oneEnded = projectTabs(REPO, [
    row("repo", [
      session("repo", "main"),
      session("repo#1", "1", { live: false, kind: "none" }),
    ]),
  ]);

  it("drops a selection once its session ends, so a reused label is not re-selected", () => {
    let selected = new Map([["repo", { key: "repo#1", seen: true }]]);
    selected = pruneSelections(selected, () => withOne);
    selected = pruneSelections(selected, () => oneEnded);
    expect(selected.has("repo")).toBe(false);
    // a new live `1` appears later: the panel stays on main
    expect(pickTab(withOne, selected.get("repo")?.key).key).toBe("repo");
  });

  it("keeps a just-launched selection until its tab first appears", () => {
    let selected = new Map([["repo", { key: "repo#1", seen: false }]]);
    selected = pruneSelections(selected, () => oneEnded);
    expect(selected.get("repo")).toEqual({ key: "repo#1", seen: false });
    selected = pruneSelections(selected, () => withOne);
    expect(selected.get("repo")).toEqual({ key: "repo#1", seen: true });
    selected = pruneSelections(selected, () => oneEnded);
    expect(selected.has("repo")).toBe(false);
  });

  it("drops a selection whose owner is gone", () => {
    const selected = new Map([["gone", { key: "gone#1", seen: true }]]);
    expect(pruneSelections(selected, () => null).size).toBe(0);
  });

  it("returns the same map when nothing changed", () => {
    const selected = new Map([["repo", { key: "repo#1", seen: true }]]);
    expect(pruneSelections(selected, () => withOne)).toBe(selected);
  });
});
