import { resolveSessionKey, type RawHookEvent } from "./event-mapper";
import type { Workspace } from "../shared/types";
import { resolveWorkspace } from "./workspaces";

export interface SessionStart {
  sessionKey: string;
  transcriptPath: string;
}

// A third reader of the hook payload, apart from the status mapper: SessionStart
// (startup, /resume, /clear, compact) names the transcript the session now
// writes, so the screen can switch files before any later hook arrives. It says
// nothing about what the session is doing.
export function mapSessionStart(
  raw: RawHookEvent,
  workspaces: Workspace[],
): SessionStart | null {
  if (raw.hook_event_name !== "SessionStart") return null;
  if (!raw.session_id || !raw.cwd || typeof raw.transcript_path !== "string")
    return null;
  const ws = resolveWorkspace(workspaces, raw.cwd);
  if (!ws) return null;
  return {
    sessionKey: resolveSessionKey(raw, ws),
    transcriptPath: raw.transcript_path,
  };
}
