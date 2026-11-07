import { describe, expect, it } from "vitest";
import { autoAnswerOutput } from "../../src/main/auto-answer";
import type { RawHookEvent } from "../../src/main/event-mapper";

const NOW = 1_000_000;

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
  jarvis_sent_at: NOW,
  tool_input: { questions } as Record<string, unknown>,
  ...over,
});

const answersOf = (raw: RawHookEvent) =>
  autoAnswerOutput(raw, NOW)?.hookSpecificOutput.updatedInput.answers;

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
    expect(autoAnswerOutput(ask([q("Pick", ["A", "B"])]), NOW)).toBeNull();
  });

  it("leaves a question with two markers", () => {
    const raw = ask([q("Pick", ["A (Recommended)", "B (recommended)"])]);
    expect(autoAnswerOutput(raw, NOW)).toBeNull();
  });

  it("leaves a multiSelect question", () => {
    const raw = ask([
      q("Pick", ["A (Recommended)", "B"], { multiSelect: true }),
    ]);
    expect(autoAnswerOutput(raw, NOW)).toBeNull();
  });

  it("does not approve outside a gate", () => {
    expect(
      autoAnswerOutput(ask([q("Deploy", ["Approve", "Stop"])]), NOW),
    ).toBeNull();
  });

  it("a Spec gate with no Approve option waits", () => {
    expect(
      autoAnswerOutput(ask([q("Spec", ["Review", "Stop"])]), NOW),
    ).toBeNull();
  });

  it("one unanswerable question makes the prompt wait", () => {
    const raw = ask([q("Spec", ["Approve"]), q("Pick", ["A", "B"])]);
    expect(autoAnswerOutput(raw, NOW)).toBeNull();
  });

  it("repeats the questions and adds answers", () => {
    const questions = [
      q("Spec", ["Approve"]),
      q("Pick", ["A (Recommended)", "B"]),
    ];
    const out = autoAnswerOutput(ask(questions), NOW);
    expect(out?.hookSpecificOutput.hookEventName).toBe("PreToolUse");
    expect(out?.hookSpecificOutput.permissionDecision).toBe("allow");
    const updated = out?.hookSpecificOutput.updatedInput;
    expect(updated?.questions).toBe(questions);
    expect(updated?.answers).toEqual({
      "Spec?": "Approve",
      "Pick?": "A (Recommended)",
    });
  });

  it("keeps the other fields of tool_input", () => {
    const raw = ask([q("Spec", ["Approve"])]);
    raw.tool_input = { ...raw.tool_input, metadata: { source: "x" } };
    const updated = autoAnswerOutput(raw, NOW)?.hookSpecificOutput.updatedInput;
    expect(updated?.metadata).toEqual({ source: "x" });
    expect(updated?.answers).toEqual({ "Spec?": "Approve" });
  });

  it("answers an event exactly 1000 ms old", () => {
    const raw = ask([q("Spec", ["Approve"])]);
    expect(autoAnswerOutput(raw, NOW + 1000)).not.toBeNull();
  });

  it("leaves an event 1001 ms old for the picker", () => {
    const raw = ask([q("Spec", ["Approve"])]);
    expect(autoAnswerOutput(raw, NOW + 1001)).toBeNull();
  });

  it("leaves an event with no send stamp", () => {
    const raw = ask([q("Spec", ["Approve"])], { jarvis_sent_at: undefined });
    expect(autoAnswerOutput(raw, NOW)).toBeNull();
  });

  it("ignores other events", () => {
    const questions = [q("Spec", ["Approve"])];
    expect(
      autoAnswerOutput(ask(questions, { jarvis_session: undefined }), NOW),
    ).toBeNull();
    expect(
      autoAnswerOutput(ask(questions, { tool_name: "Read" }), NOW),
    ).toBeNull();
    expect(
      autoAnswerOutput(ask(questions, { hook_event_name: "PostToolUse" }), NOW),
    ).toBeNull();
  });

  it("bad shapes give null", () => {
    expect(autoAnswerOutput({ ...ask([]), tool_input: {} }, NOW)).toBeNull();
    expect(autoAnswerOutput(ask("nope"), NOW)).toBeNull();
    expect(autoAnswerOutput(ask([]), NOW)).toBeNull();
    expect(autoAnswerOutput(ask([null]), NOW)).toBeNull();
  });
});
