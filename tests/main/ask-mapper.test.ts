import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { mapAskEvent } from "../../src/main/ask-mapper";
import { buildWorkspaces } from "../../src/main/workspaces";
import type { Workspace } from "../../src/shared/types";

const workspaces: Workspace[] = buildWorkspaces("D:\\vault", [
  { name: "proj", path: "D:\\proj" },
]);
const base = { session_id: "s1", cwd: "D:\\vault" };

const fixture = (name: string) =>
  JSON.parse(
    readFileSync(
      path.join(__dirname, "..", "fixtures", "hook", `${name}.json`),
      "utf8",
    ),
  ) as Parameters<typeof mapAskEvent>[0];

describe("mapAskEvent", () => {
  it("reads the questions off a PreToolUse payload", () => {
    const out = mapAskEvent(fixture("pretooluse-ask"), workspaces);
    expect(out).not.toBeNull();
    expect(out).not.toBeUndefined();
    expect(out!.questions).toHaveLength(1);
    expect(out!.questions[0].header).toBe("Close signal");
    expect(out!.questions[0].multiSelect).toBe(false);
    expect(out!.questions[0].options).toHaveLength(2);
    expect(out!.questions[0].options[0].label).toBe("Widen PostToolUse");
    expect(out!.sessionId).toBe("s1");
  });

  it("returns null for the matching PostToolUse — the answer landed", () => {
    const out = mapAskEvent(
      {
        ...base,
        hook_event_name: "PostToolUse",
        tool_name: "AskUserQuestion",
        tool_response: { choice: "Widen PostToolUse" },
      },
      workspaces,
    );
    expect(out).toBeNull();
  });

  it("returns undefined for every unrelated event", () => {
    expect(
      mapAskEvent(
        { ...base, hook_event_name: "PreToolUse", tool_name: "Read" },
        workspaces,
      ),
    ).toBeUndefined();
    expect(
      mapAskEvent({ ...base, hook_event_name: "Stop" }, workspaces),
    ).toBeUndefined();
  });

  it("returns undefined when there are no questions — an empty panel is worse than none", () => {
    expect(
      mapAskEvent(
        {
          ...base,
          hook_event_name: "PreToolUse",
          tool_name: "AskUserQuestion",
          tool_input: { questions: [] },
        },
        workspaces,
      ),
    ).toBeUndefined();
    expect(
      mapAskEvent(
        {
          ...base,
          hook_event_name: "PreToolUse",
          tool_name: "AskUserQuestion",
          tool_input: {},
        },
        workspaces,
      ),
    ).toBeUndefined();
  });

  it("drops a malformed option instead of throwing", () => {
    const out = mapAskEvent(
      {
        ...base,
        hook_event_name: "PreToolUse",
        tool_name: "AskUserQuestion",
        tool_input: {
          questions: [
            {
              question: "Which?",
              header: "H",
              options: [{ label: "ok", description: "d" }, "junk", null, 7],
            },
          ],
        },
      },
      workspaces,
    );
    expect(out!.questions[0].options).toEqual([
      { label: "ok", description: "d" },
    ]);
  });

  it("ignores a workspace it does not track", () => {
    expect(
      mapAskEvent(
        { ...fixture("pretooluse-ask"), cwd: "D:\\elsewhere" },
        workspaces,
      ),
    ).toBeUndefined();
  });
});
