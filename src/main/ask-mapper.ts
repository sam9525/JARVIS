import { resolveSessionKey, type RawHookEvent } from "./event-mapper";
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

export interface AskAnswer {
  header: string;
  label: string;
}

export interface AskPrompt {
  workspaceId: string;
  sessionKey: string;
  sessionId: string;
  questions: AskQuestion[];
  // set only on a clear: the offered option each question was answered with
  answers?: AskAnswer[];
  ts: number;
  // the renderer fills this from the session's writes; main never sets it
  docs?: Partial<Record<"spec" | "plan", string>>;
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

const isRecord = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);

// Claude Code reports the answers as { [question text]: chosen label } in
// tool_response and echoes them in tool_input. A reply that is not exactly one
// of the question's offered labels (free text, a multi-select join) is dropped,
// so a caller can trust every label it gets.
function toAnswers(raw: RawHookEvent): AskAnswer[] {
  const response = isRecord(raw.tool_response) ? raw.tool_response : {};
  const input = isRecord(raw.tool_input) ? raw.tool_input : {};
  const questions = toQuestions(response.questions ?? input.questions);
  const answers = isRecord(response.answers) ? response.answers : input.answers;
  if (!isRecord(answers)) return [];
  const out: AskAnswer[] = [];
  for (const q of questions) {
    const label = answers[q.question];
    if (typeof label === "string" && q.options.some((o) => o.label === label))
      out.push({ header: q.header, label });
  }
  return out;
}

/**
 * Third, independent mapper: same raw payload as mapHookEvent and
 * mapStatusEvent, a third question — "what is this workspace asking".
 *
 * Two return values: `undefined` means this event is not about questions and
 * nothing should change; a prompt with no questions means *this* workspace's
 * question is over. The clear carries a workspace id like every other prompt
 * does, because a fleet can hold several open questions at once and answering
 * one must not close the rest.
 */
export function mapAskEvent(
  raw: RawHookEvent,
  workspaces: Workspace[],
): AskPrompt | undefined {
  if (raw.tool_name !== "AskUserQuestion") return undefined;
  if (!raw.session_id || !raw.cwd) return undefined;
  const ws = resolveWorkspace(workspaces, raw.cwd);
  if (!ws) return undefined;
  if (raw.hook_event_name === "PostToolUse")
    return {
      workspaceId: ws.id,
      sessionKey: resolveSessionKey(raw, ws),
      sessionId: raw.session_id,
      questions: [],
      answers: toAnswers(raw),
      ts: Date.now(),
    };
  if (raw.hook_event_name !== "PreToolUse") return undefined;
  const questions = toQuestions((raw.tool_input ?? {}).questions);
  // an empty panel is worse than no panel
  if (questions.length === 0) return undefined;
  return {
    workspaceId: ws.id,
    sessionKey: resolveSessionKey(raw, ws),
    sessionId: raw.session_id,
    questions,
    ts: Date.now(),
  };
}
