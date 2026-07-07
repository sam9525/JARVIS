import { describe, it, expect } from "vitest";
import { mapHookEvent } from "../src/main/event-mapper";

// Windows-style paths on purpose — this app is Windows-first and hook
// payloads arrive with absolute Windows paths.
const base = {
  session_id: "s1",
  cwd: "D:\\vault",
};

describe("mapHookEvent", () => {
  it("PreToolUse Grep → search pulse event with pattern, no nodes", () => {
    const e = mapHookEvent({
      ...base,
      hook_event_name: "PreToolUse",
      tool_name: "Grep",
      tool_input: { pattern: "foo.*bar", path: "D:\\vault\\notes" },
    });
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
    const e = mapHookEvent({
      ...base,
      hook_event_name: "PreToolUse",
      tool_name: "Read",
      tool_input: { file_path: "D:\\vault\\notes\\beta.md" },
    });
    expect(e).toMatchObject({
      phase: "pre",
      tool: "Read",
      nodeIds: ["notes/beta"],
    });
  });

  it("PostToolUse Edit → modified event", () => {
    const e = mapHookEvent({
      ...base,
      hook_event_name: "PostToolUse",
      tool_name: "Edit",
      tool_input: { file_path: "D:\\vault\\Alpha.md" },
    });
    expect(e).toMatchObject({
      phase: "post",
      tool: "Edit",
      nodeIds: ["Alpha"],
    });
  });

  it("ignores files outside cwd", () => {
    const e = mapHookEvent({
      ...base,
      hook_event_name: "PreToolUse",
      tool_name: "Read",
      tool_input: { file_path: "C:\\elsewhere\\x.md" },
    });
    expect(e).toBeNull();
  });

  it("ignores non-markdown files", () => {
    const e = mapHookEvent({
      ...base,
      hook_event_name: "PreToolUse",
      tool_name: "Read",
      tool_input: { file_path: "D:\\vault\\image.png" },
    });
    expect(e).toBeNull();
  });

  it("ignores combos the graph does not react to (post Read, pre Edit)", () => {
    expect(
      mapHookEvent({
        ...base,
        hook_event_name: "PostToolUse",
        tool_name: "Read",
        tool_input: { file_path: "D:\\vault\\Alpha.md" },
      }),
    ).toBeNull();
    expect(
      mapHookEvent({
        ...base,
        hook_event_name: "PreToolUse",
        tool_name: "Edit",
        tool_input: { file_path: "D:\\vault\\Alpha.md" },
      }),
    ).toBeNull();
  });

  it("correctly extracts node IDs from relative and mixed-slash markdown file paths", () => {
    const e1 = mapHookEvent({
      ...base,
      hook_event_name: "PreToolUse",
      tool_name: "Read",
      tool_input: { file_path: "notes\\beta.md" },
    });
    expect(e1).toMatchObject({
      phase: "pre",
      tool: "Read",
      nodeIds: ["notes/beta"],
    });

    const e2 = mapHookEvent({
      ...base,
      hook_event_name: "PreToolUse",
      tool_name: "Read",
      tool_input: { file_path: "notes/beta.md" },
    });
    expect(e2).toMatchObject({
      phase: "pre",
      tool: "Read",
      nodeIds: ["notes/beta"],
    });
  });

  it("ignores unknown tools and malformed envelopes", () => {
    expect(
      mapHookEvent({
        ...base,
        hook_event_name: "PreToolUse",
        tool_name: "Bash",
        tool_input: { command: "ls" },
      }),
    ).toBeNull();
    expect(mapHookEvent({})).toBeNull();
  });
});