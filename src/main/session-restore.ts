import { promises as fs, writeFileSync } from "node:fs";
import path from "node:path";
import { isSessionId } from "./pty-manager";

/** A reopen this soon after the last close continues every project session
 * that was live; any later and they start fresh, as a first launch does. */
export const RESUME_WINDOW_MS = 60 * 60 * 1000;

/** How stale `closedAt` can be after a crash or a kill, which skip
 * before-quit and leave only the last heartbeat on disk. */
export const HEARTBEAT_MS = 60 * 1000;

/** A file of its own for the same reason as jarvis-briefing.json: the
 * renderer writes the whole settings object back and would clobber it. */
export const sessionsPath = (userData: string): string =>
  path.join(userData, "jarvis-sessions.json");

/** workspace id → session id to resume, from what `saved` recorded, or
 * nothing when it is missing, malformed or older than the window. */
export function sessionsToResume(
  saved: unknown,
  now: number,
): Record<string, string> {
  const p = (typeof saved === "object" && saved !== null ? saved : {}) as {
    closedAt?: unknown;
    sessions?: unknown;
  };
  if (typeof p.closedAt !== "number") return {};
  const age = now - p.closedAt;
  // a clock set back reads as a negative age; nothing proves that is recent
  if (age < 0 || age > RESUME_WINDOW_MS) return {};
  const out: Record<string, string> = {};
  if (typeof p.sessions !== "object" || p.sessions === null) return out;
  for (const [id, sid] of Object.entries(p.sessions)) {
    // the id becomes a path segment and a command-line argument
    if (typeof sid === "string" && isSessionId(sid)) out[id] = sid;
  }
  return out;
}

export async function readSavedSessions(userData: string): Promise<unknown> {
  try {
    return JSON.parse(await fs.readFile(sessionsPath(userData), "utf8"));
  } catch {
    return null; // missing or corrupt → nothing to resume
  }
}

/** Sync because before-quit is the last chance to write, and an async write
 * there races the process exit. */
export function writeSavedSessions(
  userData: string,
  sessions: Record<string, string>,
  now: number,
): void {
  try {
    writeFileSync(
      sessionsPath(userData),
      JSON.stringify({ closedAt: now, sessions }, null, 2) + "\n",
      "utf8",
    );
  } catch (err) {
    console.error("session save failed:", err);
  }
}

/** Whether Claude Code still has the transcript `--resume <id>` would read. */
export async function hasSessionTranscript(
  dir: string,
  sessionId: string,
): Promise<boolean> {
  try {
    await fs.access(path.join(dir, `${sessionId}.jsonl`));
    return true;
  } catch {
    return false;
  }
}
