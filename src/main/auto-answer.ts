import { toQuestions, type AskQuestion } from "./ask-mapper";
import type { RawHookEvent } from "./event-mapper";

export interface AutoAnswerOutput {
  hookSpecificOutput: {
    hookEventName: "PreToolUse";
    permissionDecision: "allow";
    updatedInput: Record<string, unknown>;
  };
}

const GATE_HEADERS = new Set(["spec", "plan"]);

function chooseLabel(q: AskQuestion): string | null {
  if (q.multiSelect) return null;
  if (GATE_HEADERS.has(q.header.trim().toLowerCase())) {
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
export function autoAnswerOutput(raw: RawHookEvent): AutoAnswerOutput | null {
  if (
    !raw.jarvis_session ||
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
      updatedInput: { questions: rawQuestions, answers },
    },
  };
}
