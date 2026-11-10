import { docKindOf, toQuestions, type AskQuestion } from "./ask-mapper";
import type { RawHookEvent } from "./event-mapper";

export interface AutoAnswerOutput {
  hookSpecificOutput: {
    hookEventName: "PreToolUse";
    permissionDecision: "allow";
    updatedInput: Record<string, unknown>;
  };
}

// The hook gives up at 1500 ms and the picker then opens, so an event older
// than this has an open question and must map as one, not be answered.
const MAX_EVENT_AGE_MS = 1000;

function chooseLabel(q: AskQuestion): string | null {
  if (q.multiSelect) return null;
  if (docKindOf(q.header) !== null) {
    const approve = q.options.find((o) =>
      o.label.trim().toLowerCase().startsWith("approve"),
    );
    return approve?.label ?? null;
  }
  const marked = q.options.filter((o) =>
    o.label.toLowerCase().includes("(recommended)"),
  );
  return marked.length === 1 ? marked[0].label : null;
}

// The hook can only answer the prompt as a whole, so one question without a
// clear choice returns null and the picker opens for the user.
export function autoAnswerOutput(
  raw: RawHookEvent,
  now: number = Date.now(),
): AutoAnswerOutput | null {
  if (
    !raw.jarvis_session ||
    typeof raw.jarvis_sent_at !== "number" ||
    now - raw.jarvis_sent_at > MAX_EVENT_AGE_MS ||
    raw.hook_event_name !== "PreToolUse" ||
    raw.tool_name !== "AskUserQuestion"
  )
    return null;
  const rawQuestions = raw.tool_input?.questions;
  if (!Array.isArray(rawQuestions) || rawQuestions.length === 0) return null;
  const questions = toQuestions(rawQuestions);
  if (questions.length !== rawQuestions.length) return null;

  const answers: Record<string, string> = {};
  for (const q of questions) {
    const label = chooseLabel(q);
    if (label === null) return null;
    answers[q.question] = label;
  }
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "allow",
      updatedInput: { ...raw.tool_input, answers },
    },
  };
}
