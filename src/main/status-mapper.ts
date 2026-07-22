import type { RawHookEvent } from "./event-mapper";
import type { StatusEvent, Workspace } from "../shared/types";
import { resolveWorkspace } from "./workspaces";

const CALL_MAX = 30;

// Which single argument identifies each tool's call. Anything not listed shows
// the bare tool name — guessing an argument reads worse than admitting none.
const SUBJECT: Record<string, (i: Record<string, unknown>) => string | null> = {
  Read: (i) => basename(i.file_path),
  Edit: (i) => basename(i.file_path),
  Write: (i) => basename(i.file_path),
  NotebookEdit: (i) => basename(i.file_path),
  Grep: (i) => quoted(i.pattern),
  Glob: (i) => quoted(i.pattern),
  Bash: (i) => (typeof i.command === "string" ? i.command : null),
  Task: (i) => (typeof i.subagent_type === "string" ? i.subagent_type : null),
};

function basename(v: unknown): string | null {
  if (typeof v !== "string" || !v) return null;
  const parts = v.split(/[\\/]/);
  return parts[parts.length - 1] || null;
}

function quoted(v: unknown): string | null {
  return typeof v === "string" && v ? `"${v}"` : null;
}

export function callSignature(
  toolName: string,
  input: Record<string, unknown>,
): string {
  const subject = SUBJECT[toolName]?.(input ?? {}) ?? null;
  const full = `${toolName}(${subject ?? "…"})`;
  if (full.length <= CALL_MAX) return full;
  // keep the tool name and the opening paren; the subject is what gets cut
  const room = CALL_MAX - toolName.length - 3; // "(", "…", ")"
  const cut = `${toolName}(${(subject ?? "").slice(0, Math.max(0, room))}…)`;
  // a tool name longer than the budget leaves nothing to trim — cut the label
  return cut.length <= CALL_MAX ? cut : `${cut.slice(0, CALL_MAX - 1)}…`;
}

// Second, independent mapper: same raw payload as mapHookEvent, different
// question. This one asks "what is this workspace doing", not "which nodes
// light up". Neither knows about the other.
export function mapStatusEvent(
  raw: RawHookEvent,
  workspaces: Workspace[],
): StatusEvent | null {
  if (!raw.session_id || !raw.cwd) return null;
  const ws = resolveWorkspace(workspaces, raw.cwd);
  if (!ws) return null;
  const common = {
    workspaceId: ws.id,
    sessionId: raw.session_id,
    ts: Date.now(),
  };

  switch (raw.hook_event_name) {
    case "Notification": {
      const t = raw.notification_type;
      if (t === "permission_prompt")
        return { ...common, kind: "waiting", call: "" };
      if (t === "idle_prompt") return { ...common, kind: "idle", call: "" };
      return null; // auth, elicitation, agent-view events are not our business
    }
    case "Stop":
      return { ...common, kind: "idle", call: "" };
    case "UserPromptSubmit":
      return { ...common, kind: "running", call: "" };
    case "PreToolUse":
      return {
        ...common,
        kind: "running",
        call: callSignature(String(raw.tool_name ?? ""), raw.tool_input ?? {}),
      };
    default:
      return null; // PostToolUse included — Pre already reported the call
  }
}
