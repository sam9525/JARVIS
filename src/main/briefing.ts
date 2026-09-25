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

/** The newest *.md in `dir` by mtime, absolute, or null when the folder is
 *  missing or holds none. */
export async function newestNote(dir: string): Promise<string | null> {
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch {
    return null;
  }
  let best: { file: string; mtime: number } | null = null;
  for (const name of names) {
    if (!/\.md$/i.test(name)) continue;
    const file = path.join(dir, name);
    const stat = await fs.stat(file).catch(() => null);
    if (!stat?.isFile()) continue;
    if (!best || stat.mtimeMs > best.mtime)
      best = { file, mtime: stat.mtimeMs };
  }
  return best?.file ?? null;
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
