import { describe, expect, it } from "vitest";
import { createSessionRegistry } from "../../src/main/sessions";

const main = {
  key: "d:/repo",
  workspaceId: "d:/repo",
  label: "main",
  cwd: "D:\\repo",
  worktree: false,
};
const second = {
  key: "d:/repo#1",
  workspaceId: "d:/repo",
  label: "1",
  cwd: "D:\\repo\\.worktrees\\1",
  worktree: true,
};
const other = {
  key: "d:/vault",
  workspaceId: "d:/vault",
  label: "main",
  cwd: "D:\\vault",
  worktree: false,
};

describe("createSessionRegistry", () => {
  it("lists every session of one workspace and none of another", () => {
    const reg = createSessionRegistry();
    reg.add(main);
    reg.add(second);
    reg.add(other);
    expect(reg.forWorkspace("d:/repo")).toEqual([main, second]);
    expect(reg.get("d:/repo#1")).toEqual(second);
  });

  it("returns the removed session, then forgets it", () => {
    const reg = createSessionRegistry();
    reg.add(main);
    reg.add(second);
    expect(reg.remove("d:/repo#1")).toEqual(second);
    expect(reg.get("d:/repo#1")).toBeUndefined();
    expect(reg.forWorkspace("d:/repo")).toEqual([main]);
    expect(reg.remove("d:/repo#1")).toBeUndefined();
  });

  it("holds a reservation apart from the sessions until it is released", () => {
    const reg = createSessionRegistry();
    const pending = { key: "d:/repo#1", workspaceId: "d:/repo", label: "1" };
    expect(reg.reserve(pending)).toBe(true);
    expect(reg.reserve(pending)).toBe(false);
    expect(reg.reserved("d:/repo")).toEqual([pending]);
    expect(reg.reserved("d:/vault")).toEqual([]);
    expect(reg.forWorkspace("d:/repo")).toEqual([]);
    reg.release("d:/repo#1");
    expect(reg.reserved("d:/repo")).toEqual([]);
    expect(reg.reserve(pending)).toBe(true);
  });

  it("replaces a session added again under the same key", () => {
    const reg = createSessionRegistry();
    reg.add(main);
    reg.add({ ...main, cwd: "D:\\elsewhere" });
    expect(reg.forWorkspace("d:/repo")).toEqual([
      { ...main, cwd: "D:\\elsewhere" },
    ]);
  });
});
