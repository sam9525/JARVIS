import { describe, expect, it } from "vitest";
import { autoAnswerOutput } from "../../src/main/auto-answer";
import type { RawHookEvent } from "../../src/main/event-mapper";

const opts = (...labels: string[]) =>
  labels.map((label) => ({ label, description: "" }));

const q = (
  header: string,
  labels: string[],
  extra: Record<string, unknown> = {},
) => ({
  question: `${header}?`,
  header,
  multiSelect: false,
  options: opts(...labels),
  ...extra,
});

const ask = (
  questions: unknown,
  over: Partial<RawHookEvent> = {},
): RawHookEvent => ({
  hook_event_name: "PreToolUse",
  tool_name: "AskUserQuestion",
  jarvis_session: "k",
  tool_input: { questions } as Record<string, unknown>,
  ...over,
});

const answersOf = (raw: RawHookEvent) =>
  autoAnswerOutput(raw)?.hookSpecificOutput.updatedInput.answers;

describe("autoAnswerOutput", () => {
  it.each(["Spec", "Plan", " spec ", "PLAN"])(
    "answers a %j gate with Approve",
    (header) => {
      const raw = ask([q(header, ["Approve", "Review in browser"])]);
      expect(answersOf(raw)).toEqual({ [`${header}?`]: "Approve" });
    },
  );

  it.each(["B (Recommended)", "B (recommended)"])(
    "picks the option marked Recommended: %s",
    (marked) => {
      const raw = ask([q("Pick", ["A", marked, "C"])]);
      expect(answersOf(raw)).toEqual({ "Pick?": marked });
    },
  );

  it("leaves a question with no marker", () => {
    expect(autoAnswerOutput(ask([q("Pick", ["A", "B"])]))).toBeNull();
  });

  it("leaves a question with two markers", () => {
    const raw = ask([q("Pick", ["A (Recommended)", "B (recommended)"])]);
    expect(autoAnswerOutput(raw)).toBeNull();
  });

  it("leaves a multiSelect question", () => {
    const raw = ask([
      q("Pick", ["A (Recommended)", "B"], { multiSelect: true }),
    ]);
    expect(autoAnswerOutput(raw)).toBeNull();
  });

  it("does not approve outside a gate", () => {
    expect(
      autoAnswerOutput(ask([q("Deploy", ["Approve", "Stop"])])),
    ).toBeNull();
  });

  it("a Spec gate with no Approve option waits", () => {
    expect(autoAnswerOutput(ask([q("Spec", ["Review", "Stop"])]))).toBeNull();
  });

  it("one unanswerable question makes the prompt wait", () => {
    const raw = ask([q("Spec", ["Approve"]), q("Pick", ["A", "B"])]);
    expect(autoAnswerOutput(raw)).toBeNull();
  });

  it("repeats the questions and adds answers", () => {
    const questions = [
      q("Spec", ["Approve"]),
      q("Pick", ["A (Recommended)", "B"]),
    ];
    const out = autoAnswerOutput(ask(questions));
    expect(out?.hookSpecificOutput.hookEventName).toBe("PreToolUse");
    expect(out?.hookSpecificOutput.permissionDecision).toBe("allow");
    const updated = out?.hookSpecificOutput.updatedInput;
    expect(updated?.questions).toBe(questions);
    expect(updated?.answers).toEqual({
      "Spec?": "Approve",
      "Pick?": "A (Recommended)",
    });
  });

  it("ignores other events", () => {
    const questions = [q("Spec", ["Approve"])];
    expect(
      autoAnswerOutput(ask(questions, { jarvis_session: undefined })),
    ).toBeNull();
    expect(autoAnswerOutput(ask(questions, { tool_name: "Read" }))).toBeNull();
    expect(
      autoAnswerOutput(ask(questions, { hook_event_name: "PostToolUse" })),
    ).toBeNull();
  });

  it("bad shapes give null", () => {
    expect(autoAnswerOutput({ ...ask([]), tool_input: {} })).toBeNull();
    expect(autoAnswerOutput(ask("nope"))).toBeNull();
    expect(autoAnswerOutput(ask([]))).toBeNull();
    expect(autoAnswerOutput(ask([null]))).toBeNull();
  });
});
