import { describe, it, expect } from "vitest";
import { mapHookEvent } from "../src/main/event-mapper";
import type { Workspace } from "../src/shared/types";
import { buildWorkspaces } from "../src/main/workspaces";

// Windows-style paths on purpose — this app is Windows-first and hook
// payloads arrive with absolute Windows paths.
const base = {
  session_id: "s1",
  cwd: "D:\\vault",
};

const workspaces: Workspace[] = buildWorkspaces("D:\\vault", [
  { name: "proj", path: "D:\\proj" },
]);

describe("mapHookEvent", () => {
  it("PreToolUse Grep → search pulse event with pattern, no nodes", () => {
    const e = mapHookEvent(
      {
        ...base,
        hook_event_name: "PreToolUse",
        tool_name: "Grep",
        tool_input: { pattern: "foo.*bar", path: "D:\\vault\\notes" },
      },
      workspaces,
    );
    expect(e).toMatchObject({
      sessionId: "s1",
      phase: "pre",
      tool: "Grep",
      nodeIds: [],
      pattern: "foo.*bar",
    });
    expect(typeof e?.ts).toBe("number");
  });

  it("PreToolUse Read → read event with normalized node id", () => {
    const e = mapHookEvent(
      {
        ...base,
        hook_event_name: "PreToolUse",
        tool_name: "Read",
        tool_input: { file_path: "D:\\vault\\notes\\beta.md" },
      },
      workspaces,
    );
    expect(e).toMatchObject({
      phase: "pre",
      tool: "Read",
      nodeIds: ["notes/beta"],
    });
  });

  it("PostToolUse Edit → modified event", () => {
    const e = mapHookEvent(
      {
        ...base,
        hook_event_name: "PostToolUse",
        tool_name: "Edit",
        tool_input: { file_path: "D:\\vault\\Alpha.md" },
      },
      workspaces,
    );
    expect(e).toMatchObject({
      phase: "post",
      tool: "Edit",
      nodeIds: ["Alpha"],
    });
  });

  it("ignores files outside cwd", () => {
    const e = mapHookEvent(
      {
        ...base,
        hook_event_name: "PreToolUse",
        tool_name: "Read",
        tool_input: { file_path: "C:\\elsewhere\\x.md" },
      },
      workspaces,
    );
    expect(e).toBeNull();
  });

  it("ignores non-markdown files", () => {
    const e = mapHookEvent(
      {
        ...base,
        hook_event_name: "PreToolUse",
        tool_name: "Read",
        tool_input: { file_path: "D:\\vault\\image.png" },
      },
      workspaces,
    );
    expect(e).toBeNull();
  });

  it("ignores combos the graph does not react to (post Read, pre Edit)", () => {
    expect(
      mapHookEvent(
        {
          ...base,
          hook_event_name: "PostToolUse",
          tool_name: "Read",
          tool_input: { file_path: "D:\\vault\\Alpha.md" },
        },
        workspaces,
      ),
    ).toBeNull();
    expect(
      mapHookEvent(
        {
          ...base,
          hook_event_name: "PreToolUse",
          tool_name: "Edit",
          tool_input: { file_path: "D:\\vault\\Alpha.md" },
        },
        workspaces,
      ),
    ).toBeNull();
  });

  it("correctly extracts node IDs from relative and mixed-slash markdown file paths", () => {
    const e1 = mapHookEvent(
      {
        ...base,
        hook_event_name: "PreToolUse",
        tool_name: "Read",
        tool_input: { file_path: "notes\\beta.md" },
      },
      workspaces,
    );
    expect(e1).toMatchObject({
      phase: "pre",
      tool: "Read",
      nodeIds: ["notes/beta"],
    });

    const e2 = mapHookEvent(
      {
        ...base,
        hook_event_name: "PreToolUse",
        tool_name: "Read",
        tool_input: { file_path: "notes/beta.md" },
      },
      workspaces,
    );
    expect(e2).toMatchObject({
      phase: "pre",
      tool: "Read",
      nodeIds: ["notes/beta"],
    });
  });

  it("ignores unknown tools and malformed envelopes", () => {
    expect(
      mapHookEvent(
        {
          ...base,
          hook_event_name: "PreToolUse",
          tool_name: "Bash",
          tool_input: { command: "ls" },
        },
        workspaces,
      ),
    ).toBeNull();
    expect(mapHookEvent({}, workspaces)).toBeNull();
  });

  it("UserPromptSubmit → Prompt reset event", () => {
    const e = mapHookEvent(
      {
        ...base,
        hook_event_name: "UserPromptSubmit",
      },
      workspaces,
    );
    expect(e).toMatchObject({
      sessionId: "s1",
      phase: "pre",
      tool: "Prompt",
      nodeIds: [],
    });
    expect(typeof e?.ts).toBe("number");
  });
});

describe("multi-workspace routing", () => {
  it("stamps workspaceId and routes by cwd prefix", () => {
    const e = mapHookEvent(
      {
        session_id: "s1",
        cwd: "D:\\vault",
        hook_event_name: "PreToolUse",
        tool_name: "Read",
        tool_input: { file_path: "D:\\vault\\notes\\a.md" },
      },
      workspaces,
    );
    expect(e?.workspaceId).toBe(workspaces[0].id);
    expect(e?.nodeIds).toEqual(["notes/a"]);
  });

  it("code workspace: any extension, kept in the node id", () => {
    const e = mapHookEvent(
      {
        session_id: "s1",
        cwd: "D:\\proj",
        hook_event_name: "PreToolUse",
        tool_name: "Read",
        tool_input: { file_path: "D:\\proj\\src\\x.ts" },
      },
      workspaces,
    );
    expect(e?.workspaceId).toBe(workspaces[1].id);
    expect(e?.nodeIds).toEqual(["src/x.ts"]);
  });

  it("node ids are relative to the workspace root even when cwd is a subdir", () => {
    const e = mapHookEvent(
      {
        session_id: "s1",
        cwd: "D:\\proj\\src",
        hook_event_name: "PreToolUse",
        tool_name: "Read",
        tool_input: { file_path: "D:\\proj\\src\\x.ts" },
      },
      workspaces,
    );
    expect(e?.nodeIds).toEqual(["src/x.ts"]);
  });

  it("vault keeps requiring .md for file events", () => {
    const e = mapHookEvent(
      {
        session_id: "s1",
        cwd: "D:\\vault",
        hook_event_name: "PreToolUse",
        tool_name: "Read",
        tool_input: { file_path: "D:\\vault\\script.py" },
      },
      workspaces,
    );
    expect(e).toBeNull();
  });

  it("cwd outside every workspace → dropped, including prompts", () => {
    const prompt = mapHookEvent(
      {
        session_id: "s1",
        cwd: "C:\\other",
        hook_event_name: "UserPromptSubmit",
      },
      workspaces,
    );
    expect(prompt).toBeNull();
  });

  it("prompt events carry the workspace id", () => {
    const prompt = mapHookEvent(
      {
        session_id: "s1",
        cwd: "D:\\proj",
        hook_event_name: "UserPromptSubmit",
      },
      workspaces,
    );
    expect(prompt?.workspaceId).toBe(workspaces[1].id);
    expect(prompt?.tool).toBe("Prompt");
  });
});
