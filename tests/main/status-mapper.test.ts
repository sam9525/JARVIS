/**
 * Captured hook event payload structures:
 *
 * Stop:
 *   session_id, cwd, prompt_id, permission_mode, effort, hook_event_name,
 *   stop_hook_active, last_assistant_message, background_tasks, session_crons.
 *   Note: Stop carries `stop_hook_active` and `last_assistant_message` but does NOT carry `stop_reason`.
 *
 * PreToolUse Bash:
 *   session_id, cwd, prompt_id, permission_mode, effort, hook_event_name,
 *   tool_name, tool_input, tool_use_id.
 *
 * Notification (idle_prompt and permission_prompt):
 *   session_id, cwd, prompt_id, permission_mode, effort, hook_event_name,
 *   notification_type, message.
 *   Note: Notification carries `notification_type` and `message`.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { mapStatusEvent } from "../../src/main/status-mapper";
import { callSignature } from "../../src/shared/call-signature";
import { buildWorkspaces } from "../../src/main/workspaces";
import type { Workspace } from "../../src/shared/types";

const workspaces: Workspace[] = buildWorkspaces("D:\\vault", [
  { name: "proj", path: "D:\\proj" },
  { name: "jarvis", path: "D:\\data\\Program\\JARVIS" },
]);
const base = { session_id: "s1", cwd: "D:\\vault" };

const fixture = (name: string) =>
  JSON.parse(
    readFileSync(
      path.join(__dirname, "..", "fixtures", "hook", `${name}.json`),
      "utf8",
    ),
  ) as Parameters<typeof mapStatusEvent>[0];

describe("callSignature", () => {
  it("uses the basename for file tools", () => {
    expect(
      callSignature("Edit", {
        file_path: "D:\\vault\\src\\highlight-store.ts",
      }),
    ).toBe("Edit(highlight-store.ts)");
    expect(callSignature("Read", { file_path: "notes\\alpha.md" })).toBe(
      "Read(alpha.md)",
    );
  });

  it("quotes the pattern for search tools", () => {
    expect(callSignature("Grep", { pattern: "wikilink" })).toBe(
      'Grep("wikilink")',
    );
    expect(callSignature("Glob", { pattern: "src/**/*.ts" })).toBe(
      'Glob("src/**/*.ts")',
    );
  });

  it("uses the command for Bash and the subagent type for Task", () => {
    expect(callSignature("Bash", { command: "npm test" })).toBe(
      "Bash(npm test)",
    );
    expect(callSignature("Task", { subagent_type: "Explore" })).toBe(
      "Task(Explore)",
    );
  });

  it("names the running skill", () => {
    expect(callSignature("Skill", { skill: "brainstorming" })).toBe(
      "Skill(brainstorming)",
    );
  });

  it("falls back to the bare tool name rather than guessing an argument", () => {
    expect(callSignature("WebFetch", { url: "https://example.com" })).toBe(
      "WebFetch(…)",
    );
    expect(callSignature("Edit", {})).toBe("Edit(…)");
  });

  it("truncates past 30 characters instead of wrapping", () => {
    const sig = callSignature("Bash", {
      command: "npm run build && npm run test -- --coverage",
    });
    expect(sig.length).toBeLessThanOrEqual(30);
    expect(sig.endsWith("…)")).toBe(true);
  });

  it("respects the cap even when the tool name alone exceeds it", () => {
    const sig = callSignature("AnExtremelyLongToolNameFromSomeMcpServer", {});
    expect(sig.length).toBeLessThanOrEqual(30);
  });

  it("never throws on a missing or malformed input", () => {
    expect(() => callSignature("Bash", {})).not.toThrow();
    expect(() =>
      callSignature("Edit", { file_path: 42 as unknown as string }),
    ).not.toThrow();
  });
});

describe("callSignature names", () => {
  it("shortens an MCP tool and shows its main argument", () => {
    expect(
      callSignature("mcp__gitnexus__impact", {
        target: "mapAskEvent",
        repo: "JARVIS",
      }),
    ).toBe("gitnexus impact(mapAskEvent)");
  });
  it("takes the first listed key that holds a string", () => {
    expect(
      callSignature("mcp__gitnexus__query", {
        repo: "J",
        search_query: "voice",
      }),
    ).toBe("gitnexus query(voice)");
  });
  it("shows … for an MCP call with none of the keys", () => {
    expect(callSignature("mcp__gitnexus__list_repos", {})).toBe(
      "gitnexus list_repos(…)",
    );
  });
  it("keeps the cap for a long MCP name", () => {
    const s = callSignature("mcp__playwright__browser_take_screenshot", {
      url: "x",
    });
    expect(s.length).toBeLessThanOrEqual(30);
    expect(s.startsWith("playwright ")).toBe(true);
  });
  it.each([
    ["mcp__x", "x(…)"],
    ["mcp__", "mcp__(…)"],
    ["mcp__a__b__c", "a b__c(…)"],
  ])("names the odd MCP tool %s as %s", (n, want) => {
    expect(callSignature(n, {})).toBe(want);
  });
  it("drops the plugin prefix of a skill", () => {
    expect(callSignature("Skill", { skill: "superpowers:brainstorming" })).toBe(
      "Skill(brainstorming)",
    );
    expect(callSignature("Skill", { skill: "tdd" })).toBe("Skill(tdd)");
  });
  it("names an Agent call by its description, else its type", () => {
    expect(
      callSignature("Agent", {
        description: "Implement Task 2",
        subagent_type: "general-purpose",
      }),
    ).toBe("Agent(Implement Task 2)");
    expect(callSignature("Agent", { subagent_type: "Explore" })).toBe(
      "Agent(Explore)",
    );
  });
});

describe("mapStatusEvent", () => {
  it("a permission notification is 'blocked'", () => {
    const e = mapStatusEvent(
      {
        ...base,
        hook_event_name: "Notification",
        notification_type: "permission_prompt",
      },
      workspaces,
    );
    expect(e).toMatchObject({ kind: "blocked", workspaceId: workspaces[0].id });
  });

  it("an idle notification is 'idle'", () => {
    const e = mapStatusEvent(
      {
        ...base,
        hook_event_name: "Notification",
        notification_type: "idle_prompt",
      },
      workspaces,
    );
    expect(e?.kind).toBe("idle");
  });

  it("Stop is 'idle'", () => {
    const e = mapStatusEvent({ ...base, hook_event_name: "Stop" }, workspaces);
    expect(e?.kind).toBe("idle");
  });

  it("Stop carries the transcript path when the payload has one", () => {
    const e = mapStatusEvent(
      { ...base, hook_event_name: "Stop", transcript_path: "C:\\t\\a.jsonl" },
      workspaces,
    );
    expect(e?.transcriptPath).toBe("C:\\t\\a.jsonl");
    const bare = mapStatusEvent(
      { ...base, hook_event_name: "Stop" },
      workspaces,
    );
    expect(bare).not.toHaveProperty("transcriptPath");
  });

  it("carries transcriptPath on a PreToolUse", () => {
    const e = mapStatusEvent(
      {
        ...base,
        hook_event_name: "PreToolUse",
        tool_name: "Read",
        tool_input: { file_path: "a.md" },
        transcript_path: "C:\\t\\a.jsonl",
      },
      workspaces,
    );
    expect(e?.transcriptPath).toBe("C:\\t\\a.jsonl");
  });

  it("UserPromptSubmit is 'working' with no call yet", () => {
    const e = mapStatusEvent(
      { ...base, hook_event_name: "UserPromptSubmit" },
      workspaces,
    );
    expect(e).toMatchObject({ kind: "working", call: "" });
  });

  it("UserPromptSubmit carries the submitted prompt", () => {
    const e = mapStatusEvent(
      {
        ...base,
        hook_event_name: "UserPromptSubmit",
        prompt: "Daily briefing.",
      },
      workspaces,
    );
    expect(e?.prompt).toBe("Daily briefing.");
  });

  it("PreToolUse is 'working' and carries the call signature", () => {
    const e = mapStatusEvent(
      {
        ...base,
        hook_event_name: "PreToolUse",
        tool_name: "Bash",
        tool_input: { command: "npm test" },
      },
      workspaces,
    );
    expect(e).toMatchObject({ kind: "working", call: "Bash(npm test)" });
  });

  it("routes by cwd to the right workspace", () => {
    const e = mapStatusEvent(
      {
        session_id: "s1",
        cwd: "D:\\proj\\src",
        hook_event_name: "Stop",
      },
      workspaces,
    );
    expect(e?.workspaceId).toBe(workspaces[1].id);
  });

  it("drops unknown notification types, unknown events, and unroutable cwd", () => {
    expect(
      mapStatusEvent(
        {
          ...base,
          hook_event_name: "Notification",
          notification_type: "auth_success",
        },
        workspaces,
      ),
    ).toBeNull();
    expect(
      mapStatusEvent({ ...base, hook_event_name: "PreCompact" }, workspaces),
    ).toBeNull();
    expect(
      mapStatusEvent(
        { session_id: "s1", cwd: "D:\\elsewhere", hook_event_name: "Stop" },
        workspaces,
      ),
    ).toBeNull();
    expect(mapStatusEvent({ hook_event_name: "Stop" }, workspaces)).toBeNull();
  });

  it("PostToolUse produces no status event — Pre already covered it", () => {
    expect(
      mapStatusEvent(
        {
          ...base,
          hook_event_name: "PostToolUse",
          tool_name: "Bash",
          tool_input: { command: "npm test" },
        },
        workspaces,
      ),
    ).toBeNull();
  });

  it("maps the captured Stop payload", () => {
    const raw = fixture("stop");
    const ws = buildWorkspaces("D:\\vault", [
      { name: "jarvis", path: raw.cwd as string },
    ]);
    expect(mapStatusEvent(raw, ws)?.kind).toBe("idle");
  });

  it("maps the captured permission notification to 'blocked'", () => {
    const raw = fixture("notification-permission");
    const ws = buildWorkspaces("D:\\vault", [
      { name: "jarvis", path: raw.cwd as string },
    ]);
    expect(mapStatusEvent(raw, ws)?.kind).toBe("blocked");
  });

  it("maps the captured Bash PreToolUse to a Bash call line", () => {
    const raw = fixture("pretooluse-bash");
    const ws = buildWorkspaces("D:\\vault", [
      { name: "jarvis", path: raw.cwd as string },
    ]);
    const e = mapStatusEvent(raw, ws);
    expect(e?.kind).toBe("working");
    expect(e?.call.startsWith("Bash(")).toBe(true);
  });

  it("Stop carries the last assistant message", () => {
    const e = mapStatusEvent(
      {
        ...base,
        hook_event_name: "Stop",
        last_assistant_message: "Pick A or B?",
      },
      workspaces,
    );
    expect(e).toMatchObject({ kind: "idle", message: "Pick A or B?" });
  });

  it("the captured Stop fixture carries its message", () => {
    const raw = fixture("stop");
    const ws = buildWorkspaces("D:\\vault", [
      { name: "jarvis", path: raw.cwd as string },
    ]);
    expect(mapStatusEvent(raw, ws)?.message).toBe(
      "Hey! What are we working on?",
    );
  });
});

describe("six status kinds", () => {
  it("maps a tool call to working, not running", () => {
    expect(
      mapStatusEvent(
        {
          ...base,
          hook_event_name: "PreToolUse",
          tool_name: "Read",
          tool_input: { file_path: "D:\\vault\\a.md" },
        },
        workspaces,
      )?.kind,
    ).toBe("working");
  });

  it("maps a permission prompt to blocked, not waiting", () => {
    expect(
      mapStatusEvent(fixture("notification-permission"), workspaces)?.kind,
    ).toBe("blocked");
  });

  it("maps AskUserQuestion to asking, not working", () => {
    const out = mapStatusEvent(
      {
        ...base,
        hook_event_name: "PreToolUse",
        tool_name: "AskUserQuestion",
        tool_input: {
          questions: [
            { question: "Which one?", header: "Close signal", options: [] },
          ],
        },
      },
      workspaces,
    );
    expect(out?.kind).toBe("asking");
  });

  it("carries the question header as the call line", () => {
    const out = mapStatusEvent(
      {
        ...base,
        hook_event_name: "PreToolUse",
        tool_name: "AskUserQuestion",
        tool_input: {
          questions: [
            { question: "Which one?", header: "Close signal", options: [] },
          ],
        },
      },
      workspaces,
    );
    expect(out?.call).toBe("Close signal");
  });

  it("falls back to the tool name when the header is missing", () => {
    const out = mapStatusEvent(
      {
        ...base,
        hook_event_name: "PreToolUse",
        tool_name: "AskUserQuestion",
        tool_input: { questions: [{ question: "Which one?", options: [] }] },
      },
      workspaces,
    );
    expect(out?.kind).toBe("asking");
    expect(out?.call).toBe("AskUserQuestion");
  });
});

describe("mapStatusEvent session key", () => {
  it("carries the payload's session key", () => {
    const ws = workspaces[1];
    const e = mapStatusEvent(
      {
        session_id: "s1",
        cwd: "D:\\proj",
        hook_event_name: "UserPromptSubmit",
        jarvis_session: `${ws.id}#2`,
      },
      workspaces,
    );
    expect(e?.sessionKey).toBe(`${ws.id}#2`);
    expect(e?.fromApp).toBe(true);
  });

  it("marks an event from a claude started by hand as not the app's", () => {
    const e = mapStatusEvent(
      { session_id: "s1", cwd: "D:\\proj", hook_event_name: "Stop" },
      workspaces,
    );
    expect(e?.fromApp).toBe(false);
  });
});

describe("step and stage", () => {
  const map = (raw: Record<string, unknown>) =>
    mapStatusEvent(
      { ...base, ...raw } as Parameters<typeof mapStatusEvent>[0],
      workspaces,
    );

  it("takes the step from a call's description", () => {
    expect(
      map({
        hook_event_name: "PreToolUse",
        tool_name: "Bash",
        tool_input: { command: "ls", description: "List the folder" },
      })!.step,
    ).toBe("List the folder");
  });

  it.each([undefined, "", 42])("gives no step for a description of %s", (d) => {
    expect(
      map({
        hook_event_name: "PreToolUse",
        tool_name: "Bash",
        tool_input: { command: "ls", description: d },
      })!.step,
    ).toBeUndefined();
  });

  it.each([
    ["superpowers:brainstorming", "Spec"],
    ["brainstorming", "Spec"],
    ["superpowers:writing-plans", "Plan"],
    ["superpowers:subagent-driven-development", "Build"],
    ["superpowers:executing-plans", "Build"],
  ])("maps skill %s to stage %s", (skill, stage) => {
    expect(
      map({
        hook_event_name: "PreToolUse",
        tool_name: "Skill",
        tool_input: { skill },
      })!.stage,
    ).toBe(stage);
  });

  it("gives no stage for another skill", () => {
    expect(
      map({
        hook_event_name: "PreToolUse",
        tool_name: "Skill",
        tool_input: { skill: "tdd" },
      })!.stage,
    ).toBeUndefined();
  });

  it("clears the step on a prompt and on Stop", () => {
    expect(
      map({ hook_event_name: "UserPromptSubmit", prompt: "hi" })!.step,
    ).toBe("");
    expect(map({ hook_event_name: "Stop" })!.step).toBe("");
  });
});
