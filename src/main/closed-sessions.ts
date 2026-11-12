import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { isSessionId } from "./pty-manager";

/** A project session that closed, kept so the main agent can choose to
 * `--resume` it when the user goes back to the same work. */
export interface ClosedSession {
  workspaceId: string;
  label: string;
  sessionId: string;
  cwd: string;
  topic: string;
  closedAt: number;
}

/** The newest closes kept per workspace; one workspace holds at most 4 live
 * sessions, so this covers a full set closing at once. */
export const MAX_CLOSED_PER_WORKSPACE = 4;

/** A file of its own for the same reason as jarvis-sessions.json: the renderer
 * writes the whole settings object back and would clobber it. */
export const closedPath = (userData: string): string =>
  path.join(userData, "jarvis-closed-sessions.json");

/** Adds `entry`, replacing any older close of the same label, and keeps the
 * newest MAX_CLOSED_PER_WORKSPACE of its workspace. */
export function recordClosed(
  list: ClosedSession[],
  entry: ClosedSession,
): ClosedSession[] {
  const others = list.filter(
    (c) => !(c.workspaceId === entry.workspaceId && c.label === entry.label),
  );
  const mine = [
    entry,
    ...others.filter((c) => c.workspaceId === entry.workspaceId),
  ]
    .sort((a, b) => b.closedAt - a.closedAt)
    .slice(0, MAX_CLOSED_PER_WORKSPACE);
  return [
    ...others.filter((c) => c.workspaceId !== entry.workspaceId),
    ...mine,
  ];
}

export function forgetClosed(
  list: ClosedSession[],
  workspaceId: string,
  label: string,
): ClosedSession[] {
  return list.filter(
    (c) => !(c.workspaceId === workspaceId && c.label === label),
  );
}

function isClosedSession(raw: unknown): raw is ClosedSession {
  if (typeof raw !== "object" || raw === null) return false;
  const r = raw as Record<string, unknown>;
  return (
    typeof r.workspaceId === "string" &&
    typeof r.label === "string" &&
    typeof r.cwd === "string" &&
    typeof r.topic === "string" &&
    typeof r.closedAt === "number" &&
    // the id becomes a path segment and a command-line argument
    typeof r.sessionId === "string" &&
    isSessionId(r.sessionId)
  );
}

/** Sync because boot reads it before the orchestrator answers anything. */
export function readClosed(userData: string): ClosedSession[] {
  try {
    const raw: unknown = JSON.parse(readFileSync(closedPath(userData), "utf8"));
    return Array.isArray(raw) ? raw.filter(isClosedSession) : [];
  } catch {
    return []; // missing or corrupt → nothing to offer
  }
}

/** Sync because before-quit records every live session through it. */
export function writeClosed(userData: string, list: ClosedSession[]): void {
  try {
    writeFileSync(
      closedPath(userData),
      JSON.stringify(list, null, 2) + "\n",
      "utf8",
    );
  } catch (err) {
    console.error("closed-session save failed:", err);
  }
}
