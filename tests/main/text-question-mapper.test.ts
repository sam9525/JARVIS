import { describe, it, expect } from "vitest";
import { mapTextQuestion } from "../../src/main/text-question-mapper";
import { buildWorkspaces } from "../../src/main/workspaces";
import type { Workspace } from "../../src/shared/types";

const workspaces: Workspace[] = buildWorkspaces("D:\\vault", [
  { name: "proj", path: "D:\\proj" },
]);
const stop = {
  session_id: "s1",
  cwd: "D:\\proj",
  hook_event_name: "Stop",
  last_assistant_message: "Which one?\n\n1. Fast\n2. Safe",
};

describe("mapTextQuestion", () => {
  it("builds a text prompt from a Stop that ends on a question", () => {
    const out = mapTextQuestion(stop, workspaces);
    const proj = workspaces.find((w) => w.name === "proj");
    expect(out).toMatchObject({
      workspaceId: proj?.id,
      sessionId: "s1",
      source: "text",
    });
    expect(out?.questions).toHaveLength(1);
    expect(out?.questions[0].multiSelect).toBe(false);
    expect(out?.questions[0].options.map((o) => o.label)).toEqual([
      "Fast",
      "Safe",
    ]);
    expect(out?.questions[0].options.every((o) => !!o.reply)).toBe(true);
  });

  it("returns a text clear for a Stop that is not a question", () => {
    expect(
      mapTextQuestion({ ...stop, last_assistant_message: "Done." }, workspaces),
    ).toMatchObject({ source: "text", questions: [] });
    const { last_assistant_message: _omitted, ...noMessage } = stop;
    expect(mapTextQuestion(noMessage, workspaces)).toMatchObject({
      source: "text",
      questions: [],
    });
  });

  it("is undefined for the main agent's workspace", () => {
    const self = workspaces.map((w) => ({ ...w, isSelf: true }));
    expect(mapTextQuestion(stop, self)).toBeUndefined();
  });

  it("is undefined for any event but Stop", () => {
    expect(
      mapTextQuestion({ ...stop, hook_event_name: "PreToolUse" }, workspaces),
    ).toBeUndefined();
  });

  it("is undefined for an unknown cwd", () => {
    expect(
      mapTextQuestion({ ...stop, cwd: "D:\\elsewhere" }, workspaces),
    ).toBeUndefined();
  });
});
