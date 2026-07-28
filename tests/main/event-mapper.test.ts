import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { mapHookEvent, MATCH_CAP } from "../../src/main/event-mapper";
import type { Workspace } from "../../src/shared/types";
import { buildWorkspaces } from "../../src/main/workspaces";

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

  it("PostToolUse Grep → matched node ids from tool_response", () => {
    const e = mapHookEvent(
      {
        ...base,
        hook_event_name: "PostToolUse",
        tool_name: "Grep",
        tool_input: { pattern: "alpha" },
        tool_response: {
          filenames: ["D:\\vault\\notes\\beta.md", "D:\\vault\\gamma.md"],
        },
      },
      workspaces,
    );
    expect(e).toMatchObject({
      phase: "post",
      tool: "Grep",
      pattern: "alpha",
      nodeIds: ["notes/beta", "gamma"],
    });
  });

  it("resolves the workspace-relative paths that real payloads carry", () => {
    // real captures hold "src\\renderer\\Graph.tsx", not an absolute path
    const e = mapHookEvent(
      {
        ...base,
        hook_event_name: "PostToolUse",
        tool_name: "Grep",
        tool_input: { pattern: "x" },
        tool_response: { filenames: ["notes\\beta.md", "gamma.md"] },
      },
      workspaces,
    );
    expect(e?.nodeIds).toEqual(["notes/beta", "gamma"]);
  });

  it("PostToolUse Glob in a code workspace keeps file extensions", () => {
    const e = mapHookEvent(
      {
        session_id: "s1",
        cwd: "D:\\proj",
        hook_event_name: "PostToolUse",
        tool_name: "Glob",
        tool_input: { pattern: "**/*.ts" },
        tool_response: ["D:\\proj\\src\\main\\index.ts"],
      },
      workspaces,
    );
    expect(e?.nodeIds).toEqual(["src/main/index.ts"]);
  });

  it("drops matched paths outside the workspace and non-notes in a vault", () => {
    const e = mapHookEvent(
      {
        ...base,
        hook_event_name: "PostToolUse",
        tool_name: "Grep",
        tool_input: { pattern: "x" },
        tool_response: [
          "D:\\vault\\keep.md",
          "D:\\elsewhere\\nope.md", // outside the vault
          "D:\\vault\\image.png", // not a note
        ],
      },
      workspaces,
    );
    expect(e?.nodeIds).toEqual(["keep"]);
  });

  it("collapses duplicate matches", () => {
    const e = mapHookEvent(
      {
        ...base,
        hook_event_name: "PostToolUse",
        tool_name: "Grep",
        tool_input: { pattern: "x" },
        tool_response: "D:\\vault\\a.md:1:one\nD:\\vault\\a.md:9:two",
      },
      workspaces,
    );
    expect(e?.nodeIds).toEqual(["a"]);
  });

  it("caps a broad search at MATCH_CAP nodes", () => {
    const many = Array.from({ length: 100 }, (_, i) => `D:\\vault\\n${i}.md`);
    const e = mapHookEvent(
      {
        ...base,
        hook_event_name: "PostToolUse",
        tool_name: "Grep",
        tool_input: { pattern: "x" },
        tool_response: many,
      },
      workspaces,
    );
    expect(e?.nodeIds).toHaveLength(MATCH_CAP);
    expect(e?.nodeIds[0]).toBe("n0"); // first-N, response order preserved
  });

  it("a search that matched nothing in the workspace emits no event", () => {
    const e = mapHookEvent(
      {
        ...base,
        hook_event_name: "PostToolUse",
        tool_name: "Grep",
        tool_input: { pattern: "x" },
        tool_response: "No files found",
      },
      workspaces,
    );
    expect(e).toBeNull();
  });

  it("a missing tool_response emits no event", () => {
    const e = mapHookEvent(
      {
        ...base,
        hook_event_name: "PostToolUse",
        tool_name: "Glob",
        tool_input: { pattern: "*" },
      },
      workspaces,
    );
    expect(e).toBeNull();
  });

  it("the captured Glob payload maps to node ids", () => {
    const raw = JSON.parse(
      readFileSync(
        path.join(__dirname, "..", "fixtures", "hook", "glob.json"),
        "utf8",
      ),
    ) as Parameters<typeof mapHookEvent>[0];
    // the capture came from this repo, so register it as a CODE workspace —
    // as a vault it would (correctly) drop every non-.md path and match nothing
    const ws = buildWorkspaces("D:\\vault", [
      { name: "jarvis", path: raw.cwd as string },
    ]);
    const e = mapHookEvent(raw, ws);
    expect(e?.nodeIds.length).toBeGreaterThan(0);
    expect(e?.nodeIds).toContain("src/renderer/highlight-store.ts");
  });

  // content mode is the shape with no `filenames` — the paths exist only inside
  // the `content` blob, so pin the exact ids: a drift in Claude Code's output
  // should fail here loudly rather than quietly highlighting nothing.
  it("the captured Grep content payload maps to exact node ids", () => {
    const raw = JSON.parse(
      readFileSync(
        path.join(__dirname, "..", "fixtures", "hook", "grep-content.json"),
        "utf8",
      ),
    ) as Parameters<typeof mapHookEvent>[0];
    const ws = buildWorkspaces("D:\\vault", [
      { name: "jarvis", path: raw.cwd as string },
    ]);
    expect(mapHookEvent(raw, ws)?.nodeIds).toEqual([
      "src/main/event-mapper.ts",
      "src/main/http-listener.ts",
      "src/main/gitnexus-graph.ts",
      "src/main/pty-manager.ts",
      "src/main/settings.ts",
      "src/main/watcher.ts",
      "src/main/vault-graph.ts",
    ]);
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
