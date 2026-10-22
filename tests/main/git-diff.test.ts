import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { lineChanges, parseHunks } from "../../src/main/git-diff";

describe("parseHunks", () => {
  it("marks every line of a pure addition as added", () => {
    expect(parseHunks("@@ -3,0 +4,2 @@ ctx\n+a\n+b\n")).toEqual({
      added: [4, 5],
      modified: [],
      removedAfter: [],
    });
  });

  it("marks a pure deletion after the line above it", () => {
    expect(parseHunks("@@ -5,2 +4,0 @@\n-a\n-b\n")).toEqual({
      added: [],
      modified: [],
      removedAfter: [4],
    });
  });

  it("marks a deletion at the top of the file as after line 0", () => {
    expect(parseHunks("@@ -1 +0,0 @@\n-a\n").removedAfter).toEqual([0]);
  });

  it("marks a replaced line as modified", () => {
    expect(parseHunks("@@ -7 +7 @@\n-old\n+new\n")).toEqual({
      added: [],
      modified: [7],
      removedAfter: [],
    });
  });

  it("marks lines past the replaced ones as added", () => {
    expect(parseHunks("@@ -7 +7,3 @@\n-old\n+a\n+b\n+c\n")).toEqual({
      added: [8, 9],
      modified: [7],
      removedAfter: [],
    });
  });

  it("marks the surplus of a shrinking replacement as removed", () => {
    expect(parseHunks("@@ -7,3 +7 @@\n-a\n-b\n-c\n+new\n")).toEqual({
      added: [],
      modified: [7],
      removedAfter: [7],
    });
  });

  it("reads every hunk and ignores the file header", () => {
    const diff = [
      "diff --git a/x.ts b/x.ts",
      "--- a/x.ts",
      "+++ b/x.ts",
      "@@ -1,0 +2 @@",
      "+a",
      "@@ -10,3 +11,0 @@",
      "-b",
    ].join("\n");
    expect(parseHunks(diff)).toEqual({
      added: [2],
      modified: [],
      removedAfter: [11],
    });
  });

  it("returns no changes for empty output", () => {
    expect(parseHunks("")).toEqual({
      added: [],
      modified: [],
      removedAfter: [],
    });
  });
});

describe("lineChanges", () => {
  const git = (cwd: string, ...args: string[]) =>
    execFileSync("git", args, { cwd, windowsHide: true });

  it("diffs the working file against HEAD", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "jarvis-diff-"));
    git(dir, "init", "-q");
    await writeFile(path.join(dir, "a.ts"), "one\ntwo\nthree\n");
    git(dir, "add", ".");
    git(dir, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "i");
    await writeFile(path.join(dir, "a.ts"), "one\nthree\nfour\n");
    expect(await lineChanges(dir, "a.ts")).toEqual({
      added: [3],
      modified: [],
      removedAfter: [1],
    });
  });

  it("returns no changes outside a git repository", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "jarvis-diff-"));
    await writeFile(path.join(dir, "a.ts"), "one\n");
    expect(await lineChanges(dir, "a.ts")).toEqual({
      added: [],
      modified: [],
      removedAfter: [],
    });
  });
});
