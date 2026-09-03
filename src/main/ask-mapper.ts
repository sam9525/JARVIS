import type { RawHookEvent } from "./event-mapper";
import type { Workspace } from "../shared/types";
import { resolveWorkspace } from "./workspaces";

export interface AskOption {
  label: string;
  description: string;
}

export interface AskQuestion {
  question: string;
  header: string;
  multiSelect: boolean;
  options: AskOption[];
}

export interface AskPrompt {
  workspaceId: string;
  sessionId: string;
  questions: AskQuestion[];
  ts: number;
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");

// A hook payload is not a contract. Anything that is not the shape we expect
// is dropped rather than throwing — the panel showing one fewer option beats
// the mapper taking the listener's third try block down.
function toOptions(v: unknown): AskOption[] {
  if (!Array.isArray(v)) return [];
  const out: AskOption[] = [];
  for (const raw of v) {
    if (raw === null || typeof raw !== "object") continue;
    const o = raw as Record<string, unknown>;
    const label = str(o.label);
    if (!label) continue;
    out.push({ label, description: str(o.description) });
  }
  return out;
}

function toQuestions(v: unknown): AskQuestion[] {
  if (!Array.isArray(v)) return [];
  const out: AskQuestion[] = [];
  for (const raw of v) {
    if (raw === null || typeof raw !== "object") continue;
    const q = raw as Record<string, unknown>;
    const question = str(q.question);
    if (!question) continue;
    out.push({
      question,
      header: str(q.header),
      multiSelect: q.multiSelect === true,
      options: toOptions(q.options),
    });
  }
  return out;
}

/**
 * Third, independent mapper: same raw payload as mapHookEvent and
 * mapStatusEvent, a third question — "what is this workspace asking".
 *
 * Three return values, because two would conflate two different answers:
 * `undefined` means this event is not about questions and nothing should
 * change; `null` means the question is over and the panel should close.
 */
export function mapAskEvent(
  raw: RawHookEvent,
  workspaces: Workspace[],
): AskPrompt | null | undefined {
  if (raw.tool_name !== "AskUserQuestion") return undefined;
  if (!raw.session_id || !raw.cwd) return undefined;
  const ws = resolveWorkspace(workspaces, raw.cwd);
  if (!ws) return undefined;
  if (raw.hook_event_name === "PostToolUse") return null;
  if (raw.hook_event_name !== "PreToolUse") return undefined;
  const questions = toQuestions((raw.tool_input ?? {}).questions);
  // an empty panel is worse than no panel
  if (questions.length === 0) return undefined;
  return {
    workspaceId: ws.id,
    sessionId: raw.session_id,
    questions,
    ts: Date.now(),
  };
}
