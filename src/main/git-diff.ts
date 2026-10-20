import { execFile } from "node:child_process";
import type { LineChanges } from "../shared/types";

const NONE: LineChanges = { added: [], modified: [], removedAfter: [] };

/** Line markers from `git diff --unified=0` output. A hunk that both removes
 * and adds pairs its lines up: the paired ones are modified, extra new lines
 * are added, and extra old lines are a deletion after the hunk's last line. */
export function parseHunks(diff: string): LineChanges {
  const added: number[] = [];
  const modified: number[] = [];
  const removedAfter: number[] = [];
  for (const m of diff.matchAll(
    /^@@ -\d+(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gm,
  )) {
    const removed = Number(m[1] ?? 1);
    const start = Number(m[2]);
    const count = Number(m[3] ?? 1);
    // with zero lines added, git's start is the line just above the deletion
    if (count === 0) {
      if (removed > 0) removedAfter.push(start);
      continue;
    }
    for (let i = 0; i < count; i++)
      (i < removed ? modified : added).push(start + i);
    if (removed > count) removedAfter.push(start + count - 1);
  }
  return { added, modified, removedAfter };
}

/** The working copy of `rel` against HEAD. Resolves to no changes when `root`
 * is not a repo, git is missing, or the file is untracked. */
export function lineChanges(root: string, rel: string): Promise<LineChanges> {
  return new Promise((resolve) => {
    execFile(
      "git",
      ["diff", "--no-color", "--no-ext-diff", "--unified=0", "HEAD", "--", rel],
      { cwd: root, timeout: 5000, windowsHide: true, maxBuffer: 16 << 20 },
      (err, stdout) => resolve(err ? NONE : parseHunks(stdout)),
    );
  });
}
