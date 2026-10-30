import { resolveSessionKey, type RawHookEvent } from "./event-mapper";
import type { PipelineStage, StatusEvent, Workspace } from "../shared/types";
import { resolveWorkspace } from "./workspaces";
import { callSignature } from "../shared/call-signature";

// The question's own short chip label — what AskUserQuestion provides for
// exactly this purpose. No questions, or no header, and the bare tool name is
// more honest than a guessed subject.
function askHeader(input: Record<string, unknown>): string {
  const qs = input.questions;
  if (!Array.isArray(qs) || qs.length === 0) return "AskUserQuestion";
  const h = (qs[0] as Record<string, unknown> | undefined)?.header;
  return typeof h === "string" && h ? h : "AskUserQuestion";
}

const STAGE_BY_SKILL: Record<string, PipelineStage> = {
  brainstorming: "Spec",
  "writing-plans": "Plan",
  "subagent-driven-development": "Build",
  "executing-plans": "Build",
};

function stepOf(input: Record<string, unknown>): { step?: string } {
  const d = input.description;
  return typeof d === "string" && d ? { step: d } : {};
}

function stageOf(
  tool: unknown,
  input: Record<string, unknown>,
): { stage?: PipelineStage } {
  if (tool !== "Skill" || typeof input.skill !== "string") return {};
  const stage = STAGE_BY_SKILL[input.skill.split(":").pop() ?? ""];
  return stage ? { stage } : {};
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
  const sessionKey = resolveSessionKey(raw, ws);
  const common = {
    workspaceId: ws.id,
    sessionKey,
    fromApp: raw.jarvis_session === sessionKey,
    sessionId: raw.session_id,
    ts: Date.now(),
    ...(typeof raw.transcript_path === "string"
      ? { transcriptPath: raw.transcript_path }
      : {}),
  };

  switch (raw.hook_event_name) {
    case "Notification": {
      const t = raw.notification_type;
      if (t === "permission_prompt")
        return { ...common, kind: "blocked", call: "" };
      if (t === "idle_prompt") return { ...common, kind: "idle", call: "" };
      return null; // auth, elicitation, agent-view events are not our business
    }
    case "Stop":
      return {
        ...common,
        kind: "idle",
        call: "",
        step: "",
        message:
          typeof raw.last_assistant_message === "string"
            ? raw.last_assistant_message
            : undefined,
      };
    case "UserPromptSubmit":
      return {
        ...common,
        kind: "working",
        call: "",
        step: "",
        prompt: typeof raw.prompt === "string" ? raw.prompt : undefined,
      };
    case "PreToolUse":
      // asking is ordered before the generic branch: it is the one tool call
      // whose meaning is "stopped", not "working"
      if (raw.tool_name === "AskUserQuestion")
        return {
          ...common,
          kind: "asking",
          call: askHeader(raw.tool_input ?? {}),
          ...stepOf(raw.tool_input ?? {}),
        };
      return {
        ...common,
        kind: "working",
        call: callSignature(String(raw.tool_name ?? ""), raw.tool_input ?? {}),
        ...stepOf(raw.tool_input ?? {}),
        ...stageOf(raw.tool_name, raw.tool_input ?? {}),
      };
    default:
      return null; // PostToolUse included — Pre already reported the call
  }
}
