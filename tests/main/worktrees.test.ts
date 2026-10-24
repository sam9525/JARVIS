import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createWorktree,
  existingWorktreeFolders,
  isGitRepo,
  removeWorktreeIfDone,
  worktreePath,
} from "../../src/main/worktrees";

const IDENTITY = ["-c", "user.name=Test", "-c", "user.email=test@example.com"];

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", [...IDENTITY, ...args], {
    cwd,
    encoding: "utf8",
  }).trim();
}

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "jarvis-wt-"));
  git(root, "init", "-b", "develop");
  await fs.writeFile(path.join(root, "a.txt"), "a");
  git(root, "add", "a.txt");
  git(root, "commit", "-m", "init");
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true, maxRetries: 5 });
});

describe("worktrees", () => {
  it("creates a detached worktree at develop and excludes the folder once", async () => {
    const wt = await createWorktree(root, "1");
    await createWorktree(root, "2");
    expect(wt).toBe(worktreePath(root, "1"));
    expect(git(wt, "rev-parse", "HEAD")).toBe(
      git(root, "rev-parse", "develop"),
    );
    expect(() => git(wt, "symbolic-ref", "-q", "HEAD")).toThrow();
    const exclude = await fs.readFile(
      path.join(root, ".git", "info", "exclude"),
      "utf8",
    );
    expect(exclude.split(".worktrees/").length - 1).toBe(1);
    expect(await existingWorktreeFolders(root)).toEqual(["1", "2"]);
  });

  it("removes a worktree holding only the JARVIS hook settings, excluded once", async () => {
    const wt = await createWorktree(root, "1");
    await createWorktree(root, "2");
    await fs.mkdir(path.join(wt, ".claude"));
    await fs.writeFile(path.join(wt, ".claude", "settings.local.json"), "{}");
    const exclude = await fs.readFile(
      path.join(root, ".git", "info", "exclude"),
      "utf8",
    );
    expect(exclude.split(".claude/settings.local.json").length - 1).toBe(1);
    expect(await removeWorktreeIfDone(root, wt)).toEqual({ removed: true });
  });

  it("lists no folders when .worktrees is missing", async () => {
    expect(await existingWorktreeFolders(root)).toEqual([]);
  });

  it("removes a clean worktree with no commits of its own", async () => {
    const wt = await createWorktree(root, "1");
    expect(await removeWorktreeIfDone(root, wt)).toEqual({ removed: true });
    await expect(fs.stat(wt)).rejects.toThrow();
  });

  it("keeps a worktree with uncommitted changes", async () => {
    const wt = await createWorktree(root, "1");
    await fs.writeFile(path.join(wt, "new.txt"), "x");
    const result = await removeWorktreeIfDone(root, wt);
    expect(result.removed).toBe(false);
    expect(!result.removed && result.reason).toContain("uncommitted");
    await expect(fs.stat(wt)).resolves.toBeDefined();
  });

  it("keeps a worktree whose commit is not in develop, removes it once merged", async () => {
    const wt = await createWorktree(root, "1");
    await fs.writeFile(path.join(wt, "b.txt"), "b");
    git(wt, "add", "b.txt");
    git(wt, "commit", "-m", "work");
    const kept = await removeWorktreeIfDone(root, wt);
    expect(kept.removed).toBe(false);
    expect(!kept.removed && kept.reason).toContain("not merged");

    git(root, "merge", "--ff-only", git(wt, "rev-parse", "HEAD"));
    expect(await removeWorktreeIfDone(root, wt)).toEqual({ removed: true });
  });

  it("detects a git repo", async () => {
    expect(await isGitRepo(root)).toBe(true);
    const plain = await fs.mkdtemp(path.join(os.tmpdir(), "jarvis-plain-"));
    try {
      expect(await isGitRepo(plain)).toBe(false);
    } finally {
      await fs.rm(plain, { recursive: true, force: true });
    }
  });
});

describe("worktrees without a develop branch", () => {
  beforeEach(() => {
    git(root, "branch", "-m", "develop", "main");
  });

  it("keeps a worktree holding a commit of its own", async () => {
    const wt = await createWorktree(root, "1");
    await fs.writeFile(path.join(wt, "b.txt"), "b");
    git(wt, "add", "b.txt");
    git(wt, "commit", "-m", "work");
    const result = await removeWorktreeIfDone(root, wt);
    expect(result.removed).toBe(false);
    expect(!result.removed && result.reason).toContain("not merged");
    await expect(fs.stat(wt)).resolves.toBeDefined();
  });

  it("removes a clean worktree with no commits of its own", async () => {
    const wt = await createWorktree(root, "1");
    expect(await removeWorktreeIfDone(root, wt)).toEqual({ removed: true });
  });
});

describe("removeWorktreeIfDone on a missing folder", () => {
  it("reports the folder as missing instead of throwing", async () => {
    const result = await removeWorktreeIfDone(root, worktreePath(root, "9"));
    expect(result.removed).toBe(false);
    expect(!result.removed && result.reason).toContain("missing");
  });
});
