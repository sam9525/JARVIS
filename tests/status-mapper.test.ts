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
import { mapStatusEvent, callSignature } from "../src/main/status-mapper";
import { buildWorkspaces } from "../src/main/workspaces";
import type { Workspace } from "../src/shared/types";

const workspaces: Workspace[] = buildWorkspaces("D:\\vault", [
  { name: "proj", path: "D:\\proj" },
]);
const base = { session_id: "s1", cwd: "D:\\vault" };

const fixture = (name: string) =>
  JSON.parse(
    readFileSync(
      path.join(__dirname, "fixtures", "hook", `${name}.json`),
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

describe("mapStatusEvent", () => {
  it("a permission notification is 'waiting'", () => {
    const e = mapStatusEvent(
      {
        ...base,
        hook_event_name: "Notification",
        notification_type: "permission_prompt",
      },
      workspaces,
    );
    expect(e).toMatchObject({ kind: "waiting", workspaceId: workspaces[0].id });
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

  it("UserPromptSubmit is 'running' with no call yet", () => {
    const e = mapStatusEvent(
      { ...base, hook_event_name: "UserPromptSubmit" },
      workspaces,
    );
    expect(e).toMatchObject({ kind: "running", call: "" });
  });

  it("PreToolUse is 'running' and carries the call signature", () => {
    const e = mapStatusEvent(
      {
        ...base,
        hook_event_name: "PreToolUse",
        tool_name: "Bash",
        tool_input: { command: "npm test" },
      },
      workspaces,
    );
    expect(e).toMatchObject({ kind: "running", call: "Bash(npm test)" });
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

  it("maps the captured permission notification to 'waiting'", () => {
    const raw = fixture("notification-permission");
    const ws = buildWorkspaces("D:\\vault", [
      { name: "jarvis", path: raw.cwd as string },
    ]);
    expect(mapStatusEvent(raw, ws)?.kind).toBe("waiting");
  });

  it("maps the captured Bash PreToolUse to a Bash call line", () => {
    const raw = fixture("pretooluse-bash");
    const ws = buildWorkspaces("D:\\vault", [
      { name: "jarvis", path: raw.cwd as string },
    ]);
    const e = mapStatusEvent(raw, ws);
    expect(e?.kind).toBe("running");
    expect(e?.call.startsWith("Bash(")).toBe(true);
  });

  it("Stop carries the last assistant message", () => {
    const e = mapStatusEvent(
      { ...base, hook_event_name: "Stop", last_assistant_message: "Pick A or B?" },
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
