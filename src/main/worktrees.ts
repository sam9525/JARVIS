import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";

const WORKTREES_DIR = ".worktrees";

function git(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("git", args, { cwd, windowsHide: true }, (err, stdout) =>
      err ? reject(err) : resolve(stdout.trim()),
    );
  });
}

async function succeeds(cwd: string, args: string[]): Promise<boolean> {
  try {
    await git(cwd, args);
    return true;
  } catch {
    return false;
  }
}

/** The commit new worktrees start from and removal compares against:
 *  `develop` when that branch exists, else the main folder's `HEAD`. */
async function startPoint(root: string): Promise<string> {
  return (await succeeds(root, ["rev-parse", "--verify", "develop"]))
    ? "develop"
    : "HEAD";
}

export function isGitRepo(root: string): Promise<boolean> {
  return succeeds(root, ["rev-parse", "--is-inside-work-tree"]);
}

export function worktreePath(root: string, label: string): string {
  return path.join(root, WORKTREES_DIR, label);
}

export async function existingWorktreeFolders(root: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(path.join(root, WORKTREES_DIR), {
      withFileTypes: true,
    });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
}

async function excludeWorktreesFolder(root: string): Promise<void> {
  const excludeFile = path.resolve(
    root,
    await git(root, ["rev-parse", "--git-path", "info/exclude"]),
  );
  const entry = `${WORKTREES_DIR}/`;
  let current = "";
  try {
    current = await fs.readFile(excludeFile, "utf8");
  } catch {
    await fs.mkdir(path.dirname(excludeFile), { recursive: true });
  }
  if (current.split(/\r?\n/).includes(entry)) return;
  const separator = current === "" || current.endsWith("\n") ? "" : "\n";
  await fs.appendFile(excludeFile, `${separator}${entry}\n`);
}

export async function createWorktree(
  root: string,
  label: string,
): Promise<string> {
  const wtPath = worktreePath(root, label);
  await excludeWorktreesFolder(root);
  await git(root, [
    "worktree",
    "add",
    "--detach",
    wtPath,
    await startPoint(root),
  ]);
  return wtPath;
}

/** Removes the worktree only when nothing would be lost: no uncommitted
 *  changes, and its commits are already in the start point (or it has none). */
export async function removeWorktreeIfDone(
  root: string,
  wtPath: string,
): Promise<{ removed: true } | { removed: false; reason: string }> {
  if ((await git(wtPath, ["status", "--porcelain"])) !== "") {
    return { removed: false, reason: "uncommitted changes" };
  }
  const start = await startPoint(root);
  const merged = await succeeds(wtPath, [
    "merge-base",
    "--is-ancestor",
    "HEAD",
    start,
  ]);
  if (!merged) {
    const ahead = await git(wtPath, ["rev-list", "--count", `${start}..HEAD`]);
    if (ahead !== "0")
      return { removed: false, reason: "commits not merged into develop" };
  }
  await git(root, ["worktree", "remove", wtPath]);
  return { removed: true };
}
