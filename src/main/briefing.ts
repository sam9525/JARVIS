import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";

/** Claude Code's per-cwd transcript folder: every character that is not a
 * letter or a digit becomes `-`. */
export function transcriptDir(home: string, rootPath: string): string {
  return path.join(
    home,
    ".claude",
    "projects",
    rootPath.replace(/[^a-zA-Z0-9]/g, "-"),
  );
}

/** Whether `dir` holds any .jsonl — all `--continue` needs to know. */
export async function hasTranscript(dir: string): Promise<boolean> {
  try {
    return (await fs.readdir(dir)).some((n) => n.endsWith(".jsonl"));
  } catch {
    return false; // no folder means no session to continue
  }
}

/** Today as YYYY-MM-DD in local time, so dates compare as strings. "First
 * open today" is a question about the user's day, not UTC's. */
export function todayLocal(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Every *.md in `dir` whose filename carries the latest YYYY-MM-DD, absolute
 *  and sorted — one per machine when each writes its own note for the day
 *  (`2026-10-12.md`, `2026-10-12-Mac.md`). Empty when the folder is missing
 *  or holds no dated note. The filename, not mtime: a git pull stamps every
 *  file it writes with the pull time. */
export async function latestNotes(dir: string): Promise<string[]> {
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch {
    return [];
  }
  const dated = names.flatMap((name) => {
    const date = /\.md$/i.test(name)
      ? /\d{4}-\d{2}-\d{2}/.exec(name)?.[0]
      : undefined;
    return date ? [{ name, date }] : [];
  });
  const latest = dated.reduce((max, n) => (n.date > max ? n.date : max), "");
  return dated
    .filter((n) => n.date === latest)
    .map((n) => path.join(dir, n.name))
    .sort();
}

/** `git pull --ff-only` in `dir`, resolving either way: offline, not a repo,
 *  no git, diverged or past `timeoutMs` all leave the local copy to brief
 *  from. */
export function pullNotes(dir: string, timeoutMs = 15_000): Promise<void> {
  return new Promise((resolve) => {
    execFile(
      "git",
      ["-C", dir, "pull", "--ff-only"],
      { timeout: timeoutMs, windowsHide: true },
      () => resolve(),
    );
  });
}

export interface Briefing {
  notesDir: string | null;
  lastBriefed: string | null;
}

/** A file of its own rather than a field in jarvis-settings.json: the
 * renderer owns that file and writes the whole object back, so anything main
 * appended there would be clobbered. */
export const briefingPath = (userData: string): string =>
  path.join(userData, "jarvis-briefing.json");

export async function readBriefing(userData: string): Promise<Briefing> {
  try {
    const parsed: unknown = JSON.parse(
      await fs.readFile(briefingPath(userData), "utf8"),
    );
    const p = (
      typeof parsed === "object" && parsed !== null ? parsed : {}
    ) as Record<string, unknown>;
    const str = (v: unknown) => (typeof v === "string" && v ? v : null);
    return { notesDir: str(p.notesDir), lastBriefed: str(p.lastBriefed) };
  } catch {
    return { notesDir: null, lastBriefed: null }; // missing or unreadable → off
  }
}

export async function writeBriefing(
  userData: string,
  b: Briefing,
): Promise<void> {
  await fs.writeFile(
    briefingPath(userData),
    JSON.stringify(b, null, 2) + "\n",
    "utf8",
  );
}
