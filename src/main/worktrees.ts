import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";

const WORKTREES_DIR = ".worktrees";
// ensureHooks writes this into every session folder; untracked, it would make
// a finished worktree look dirty and keep it on disk at close
const HOOK_SETTINGS = ".claude/settings.local.json";

// Folders whose loose files (directly inside, not in a subfolder) tools drop
// into a session's worktree; untracked, they are not work
const TOOL_LEFTOVERS = [".playwright-mcp/"];

// Ignored paths a tool can rebuild; any other ignored path may be the only copy
// of a person's work (a spec under an ignored docs/, a local .env)
const REBUILDABLE = [
  HOOK_SETTINGS,
  "node_modules/",
  "out/",
  "dist/",
  "build/",
  ".vite/",
  ".gitnexus/",
  ".claude/",
  ".mcp.json",
];

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

/** The commit new worktrees start from and removal compares against, as a
 *  SHA resolved in the main folder: `develop` when that branch exists, else
 *  the main folder's `HEAD`. A SHA means the same thing from inside a worktree. */
async function startPoint(root: string): Promise<string> {
  try {
    return await git(root, ["rev-parse", "--verify", "refs/heads/develop"]);
  } catch {
    return git(root, ["rev-parse", "HEAD"]);
  }
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

async function excludeSessionFiles(root: string): Promise<void> {
  const excludeFile = path.resolve(
    root,
    await git(root, ["rev-parse", "--git-path", "info/exclude"]),
  );
  let current = "";
  try {
    current = await fs.readFile(excludeFile, "utf8");
  } catch {
    await fs.mkdir(path.dirname(excludeFile), { recursive: true });
  }
  const lines = current.split(/\r?\n/);
  const missing = [`${WORKTREES_DIR}/`, HOOK_SETTINGS].filter(
    (entry) => !lines.includes(entry),
  );
  if (missing.length === 0) return;
  const separator = current === "" || current.endsWith("\n") ? "" : "\n";
  await fs.appendFile(excludeFile, `${separator}${missing.join("\n")}\n`);
}

export async function createWorktree(
  root: string,
  label: string,
): Promise<string> {
  const wtPath = worktreePath(root, label);
  await excludeSessionFiles(root);
  await git(root, [
    "worktree",
    "add",
    "--detach",
    wtPath,
    await startPoint(root),
  ]);
  return wtPath;
}

/** Ignored paths git reports that are not REBUILDABLE. `matching` reports an
 *  ignored folder once, so a large node_modules is never walked. */
async function ignoredWork(wtPath: string): Promise<string[]> {
  const entries = await git(wtPath, [
    "status",
    "--porcelain",
    "-z",
    "--ignored=matching",
    "--untracked-files=normal",
  ]);
  return entries
    .split("\0")
    .filter((entry) => entry.startsWith("!! "))
    .map((entry) => entry.slice(3))
    .filter((file) => !REBUILDABLE.includes(file));
}

/** Any untracked file other than a loose file in a TOOL_LEFTOVERS folder is
 *  work; status lists each untracked file so a filed subfolder shows up. Tracked changes count
 *  only when they differ beyond line endings. */
async function hasUncommittedWork(wtPath: string): Promise<boolean> {
  const entries = (
    await git(wtPath, [
      "status",
      "--porcelain",
      "-z",
      "--untracked-files=all",
      "--ignore-submodules=none",
    ])
  )
    .split("\0")
    .filter((entry) => entry !== "");
  const untracked = entries.filter((entry) => entry.startsWith("??"));
  const isLeftover = (entry: string) =>
    TOOL_LEFTOVERS.some((prefix) => {
      const file = entry.slice(3);
      return (
        file.startsWith(prefix) && !file.slice(prefix.length).includes("/")
      );
    });
  if (untracked.some((entry) => !isLeftover(entry))) return true;
  if (untracked.length === entries.length) return false;
  const changed = await git(wtPath, [
    "diff",
    "HEAD",
    "--ignore-cr-at-eol",
    "--numstat",
  ]);
  return changed !== "";
}

/** Whether closing the worktree would lose work: uncommitted changes, ignored
 *  files that cannot be rebuilt, or commits not yet in the start point. A missing folder has nothing to lose;
 *  a git failure counts as not clean so a close never discards on a guess. */
export async function worktreeCheck(
  root: string,
  wtPath: string,
): Promise<{ clean: true } | { clean: false; reason: string }> {
  try {
    await fs.stat(wtPath);
  } catch {
    return { clean: true };
  }
  try {
    if (await hasUncommittedWork(wtPath)) {
      return { clean: false, reason: "uncommitted changes" };
    }
    const ignored = await ignoredWork(wtPath);
    if (ignored.length > 0) {
      return {
        clean: false,
        reason: `gitignored files (${ignored.join(", ")})`,
      };
    }
    const start = await startPoint(root);
    const merged = await succeeds(wtPath, [
      "merge-base",
      "--is-ancestor",
      "HEAD",
      start,
    ]);
    if (!merged) {
      const ahead = await git(wtPath, [
        "rev-list",
        "--count",
        `${start}..HEAD`,
      ]);
      if (ahead !== "0")
        return {
          clean: false,
          reason: "commits not merged into the start point",
        };
    }
    return { clean: true };
  } catch (err) {
    return { clean: false, reason: (err as Error).message };
  }
}

/** Whether the worktree did work that is now in the start point: HEAD moved
 *  off the commit `git worktree add` checked out (the oldest HEAD reflog
 *  entry), is an ancestor of the start point, and nothing is uncommitted. */
export async function worktreeMerged(
  root: string,
  wtPath: string,
): Promise<boolean> {
  try {
    const reflog = await git(wtPath, ["reflog", "--format=%H", "HEAD"]);
    const created = reflog.split("\n").pop()?.trim();
    if (!created) return false;
    if ((await git(wtPath, ["rev-parse", "HEAD"])) === created) return false;
    const start = await startPoint(root);
    const inStart = await succeeds(wtPath, [
      "merge-base",
      "--is-ancestor",
      "HEAD",
      start,
    ]);
    return inStart && (await worktreeCheck(root, wtPath)).clean;
  } catch {
    return false;
  }
}

/** Removes the worktree only when nothing would be lost: no uncommitted
 *  changes or ignored work, and its commits are already in the start point (or it has none). */
export async function removeWorktreeIfDone(
  root: string,
  wtPath: string,
): Promise<{ removed: true } | { removed: false; reason: string }> {
  try {
    await fs.stat(wtPath);
  } catch {
    return { removed: false, reason: "worktree folder is missing" };
  }
  const check = await worktreeCheck(root, wtPath);
  if (!check.clean) return { removed: false, reason: check.reason };
  // --force is safe here: worktreeCheck passed, so what remains is leftovers,
  // rebuildable output and line-ending noise that a plain remove would refuse
  await git(root, ["worktree", "remove", "--force", wtPath]);
  await git(root, ["worktree", "prune"]);
  return { removed: true };
}
