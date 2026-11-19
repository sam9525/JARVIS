import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createAntigravityAdapter } from "../../../src/main/agents/antigravity";
import { antigravityArgs } from "../../../src/main/agents/antigravity-hooks";
import type { RawHookEvent } from "../../../src/main/event-mapper";

const UUID = "ceda3445-c9db-4ba8-9f3f-4971079c008c";

const fixture = (name: string): Record<string, unknown> =>
  JSON.parse(
    readFileSync(
      path.join(
        __dirname,
        "..",
        "..",
        "fixtures",
        "antigravity",
        `${name}.json`,
      ),
      "utf8",
    ),
  );

const JARVIS_FIELDS = {
  jarvis_session: "c:/work/demo#2",
  jarvis_sent_at: 1,
  jarvis_agent: "antigravity",
};

const adapter = createAntigravityAdapter({
  locate: async () => "C:/x/agy.exe",
});
const normalizeBody = (body: Record<string, unknown>) => {
  const out = adapter.normalize({ ...body, ...JARVIS_FIELDS });
  for (const payload of out) {
    expect(payload).not.toHaveProperty("transcript_path");
    expect(payload).not.toHaveProperty("transcriptPath");
    expect(payload.session_id).toBe(body.conversationId);
    expect(payload.cwd).toBe("C:\\work\\demo");
    expect(payload.jarvis_session).toBe("c:/work/demo#2");
    expect(payload.jarvis_sent_at).toBe(1);
    expect(payload.jarvis_agent).toBe("antigravity");
  }
  return out;
};
const normalize = (name: string) => normalizeBody(fixture(name));
const pick = (out: RawHookEvent[]) =>
  out.map(({ hook_event_name, tool_name, tool_input }) => ({
    hook_event_name,
    tool_name,
    tool_input,
  }));
const withCommand = (commandLine: string) => {
  const body = fixture("pre-run-command");
  const toolCall = body.toolCall as { args: Record<string, unknown> };
  return {
    ...body,
    toolCall: {
      ...toolCall,
      args: { ...toolCall.args, CommandLine: commandLine },
    },
  };
};
const stopWith = (fields: Record<string, unknown>) => ({
  ...fixture("stop"),
  ...fields,
});

describe("antigravity normalize", () => {
  it("drops SessionStart", () => {
    expect(normalize("session-start")).toEqual([]);
  });

  it("turns the first PreInvocation into UserPromptSubmit and drops later ones", () => {
    const [out, ...rest] = normalize("pre-invocation-first");
    expect(rest).toEqual([]);
    expect(out.hook_event_name).toBe("UserPromptSubmit");
    expect(out.prompt).toBe(fixture("pre-invocation-first").lastUserInput);
    expect(normalize("pre-invocation-later")).toEqual([]);
  });

  it("turns read_file into Read with / paths, before and after", () => {
    const read = { file_path: "C:/work/demo/greet.js" };
    expect(pick(normalize("pre-read"))).toEqual([
      { hook_event_name: "PreToolUse", tool_name: "Read", tool_input: read },
    ]);
    expect(pick(normalize("post-read"))).toEqual([
      { hook_event_name: "PostToolUse", tool_name: "Read", tool_input: read },
    ]);
  });

  it("passes a command it cannot read through as Bash", () => {
    expect(pick(normalize("pre-run-command"))).toEqual([
      {
        hook_event_name: "PreToolUse",
        tool_name: "Bash",
        tool_input: { command: "node missing-file.js" },
      },
    ]);
    expect(pick(normalize("post-run-command-failed"))).toEqual([
      {
        hook_event_name: "PostToolUse",
        tool_name: "Bash",
        tool_input: { command: "node missing-file.js" },
      },
    ]);
  });

  it("does not parse a command after it ran", () => {
    const post = {
      ...withCommand("cat README.md"),
      hookEventName: "PostToolUse",
    };
    expect(pick(normalizeBody(post))).toEqual([
      {
        hook_event_name: "PostToolUse",
        tool_name: "Bash",
        tool_input: { command: "cat README.md" },
      },
    ]);
  });

  it("turns a shell read into a Read joined to cwd", () => {
    expect(pick(normalizeBody(withCommand("cat README.md")))).toEqual([
      {
        hook_event_name: "PreToolUse",
        tool_name: "Read",
        tool_input: { file_path: "C:/work/demo/README.md" },
      },
    ]);
  });

  it("turns a shell search into a Grep", () => {
    expect(pick(normalizeBody(withCommand("rg -n greet .")))).toEqual([
      {
        hook_event_name: "PreToolUse",
        tool_name: "Grep",
        tool_input: { pattern: "greet" },
      },
    ]);
  });

  it("reads the recorded PowerShell searches and listing", () => {
    expect(pick(normalize("pre-search-text"))).toEqual([
      {
        hook_event_name: "PreToolUse",
        tool_name: "Grep",
        tool_input: { pattern: "greet" },
      },
    ]);
    expect(pick(normalize("pre-search-files"))).toEqual([
      {
        hook_event_name: "PreToolUse",
        tool_name: "Grep",
        tool_input: { pattern: "*.js" },
      },
    ]);
    expect(pick(normalize("pre-list-folder"))).toEqual([
      {
        hook_event_name: "PreToolUse",
        tool_name: "Bash",
        tool_input: { command: "Get-ChildItem" },
      },
    ]);
  });

  it("turns edit_file and write_file into Edit and Write after they ran", () => {
    expect(pick(normalize("post-edit"))).toEqual([
      {
        hook_event_name: "PostToolUse",
        tool_name: "Edit",
        tool_input: { file_path: "C:/work/demo/greet.js" },
      },
    ]);
    expect(pick(normalize("post-new-file"))).toEqual([
      {
        hook_event_name: "PostToolUse",
        tool_name: "Write",
        tool_input: { file_path: "C:/work/demo/notes.txt" },
      },
    ]);
  });

  it("passes an edit tool through under its own name before it runs", () => {
    for (const name of ["pre-edit", "pre-new-file"]) {
      const toolCall = fixture(name).toolCall as Record<string, unknown>;
      expect(pick(normalize(name))).toEqual([
        {
          hook_event_name: "PreToolUse",
          tool_name: toolCall.name,
          tool_input: toolCall.args,
        },
      ]);
    }
  });

  it("passes call_mcp_tool and an unknown tool through unchanged", () => {
    expect(pick(normalize("pre-mcp"))).toEqual([
      {
        hook_event_name: "PreToolUse",
        tool_name: "call_mcp_tool",
        tool_input: {
          Arguments: {},
          ServerName: "gitnexus",
          ToolName: "list_repos",
        },
      },
    ]);
    const unknown = {
      ...fixture("pre-read"),
      toolCall: { id: "x", name: "view_image", args: { Image: "a.png" } },
    };
    expect(pick(normalizeBody(unknown))).toEqual([
      {
        hook_event_name: "PreToolUse",
        tool_name: "view_image",
        tool_input: { Image: "a.png" },
      },
    ]);
  });

  it("keeps the last message of a finished Stop", () => {
    const [out, ...rest] = normalizeBody(
      stopWith({ lastAssistantMessage: "done" }),
    );
    expect(rest).toEqual([]);
    expect(out.hook_event_name).toBe("Stop");
    expect(out.last_assistant_message).toBe("done");
    expect(out).not.toHaveProperty("lastAssistantMessage");
    const [bare] = normalize("stop");
    expect(bare.hook_event_name).toBe("Stop");
    expect(bare.last_assistant_message).toBe("");
  });

  it("turns a cancelled Stop into an idle_prompt Notification", () => {
    expect(
      normalizeBody(stopWith({ terminationReason: "USER_CANCELED" })),
    ).toEqual([
      expect.objectContaining({
        hook_event_name: "Notification",
        notification_type: "idle_prompt",
      }),
    ]);
  });

  it("turns a failed Stop into StopFailure with the error or the reason", () => {
    expect(normalizeBody(stopWith({ error: "boom" }))).toEqual([
      expect.objectContaining({
        hook_event_name: "StopFailure",
        error: "boom",
      }),
    ]);
    expect(
      normalizeBody(
        stopWith({ error: "", terminationReason: "MAX_INVOCATIONS" }),
      ),
    ).toEqual([
      expect.objectContaining({
        hook_event_name: "StopFailure",
        error: "MAX_INVOCATIONS",
      }),
    ]);
  });

  it("gives StopFailure a string error when the reason is not a string", () => {
    expect(
      normalizeBody(stopWith({ error: "", terminationReason: 7 })),
    ).toEqual([
      expect.objectContaining({ hook_event_name: "StopFailure", error: "7" }),
    ]);
  });

  it("omits session_id when the body has no conversationId", () => {
    const body = fixture("pre-read");
    delete body.conversationId;
    const out = adapter.normalize(body);
    expect(out).not.toHaveLength(0);
    for (const payload of out) expect(payload).not.toHaveProperty("session_id");
  });

  it("gives nothing for a body with no event or no tool call, and never throws", () => {
    expect(adapter.normalize({})).toEqual([]);
    expect(adapter.normalize({ hookEventName: "PostInvocation" })).toEqual([]);
    const noEvent = fixture("pre-read");
    delete noEvent.hookEventName;
    expect(adapter.normalize(noEvent)).toEqual([]);
    for (const toolCall of [undefined, null, "read_file", 5, []]) {
      expect(adapter.normalize({ ...fixture("pre-read"), toolCall })).toEqual(
        [],
      );
    }
    expect(() =>
      adapter.normalize({
        ...fixture("pre-run-command"),
        cwd: 5,
        toolCall: { name: "run_command", args: "x" },
      }),
    ).not.toThrow();
  });
});

describe("antigravity gateEvent", () => {
  const gate = (body: Record<string, unknown>) => adapter.gateEvent?.(body);

  it("names the first PreInvocation UserPromptSubmit", () => {
    expect(gate(fixture("pre-invocation-first"))).toBe("UserPromptSubmit");
    expect(gate(fixture("pre-invocation-later"))).toBe("PreInvocation");
  });

  it("names a cancelled Stop Interrupt", () => {
    expect(gate(stopWith({ terminationReason: "USER_CANCELED" }))).toBe(
      "Interrupt",
    );
    expect(gate(fixture("stop"))).toBe("Stop");
  });

  it("keeps any other event name, and gives undefined without one", () => {
    expect(gate(fixture("pre-read"))).toBe("PreToolUse");
    expect(gate({})).toBeUndefined();
  });
});

describe("antigravity adapter", () => {
  const opts = {
    dangerous: false,
    resume: false as boolean | string,
    forwardPath: "C:\\app\\src\\hook\\forward.mjs",
    hooksRoot: "C:\\data\\antigravity-hooks",
  };

  it("has the id and features of an agent with no panels", () => {
    expect(adapter.id).toBe("antigravity");
    expect(adapter.features).toEqual({
      transcript: false,
      askPanel: false,
      permissionCard: false,
      statusLine: false,
      slashList: false,
      trustCheck: false,
      resume: true,
    });
  });

  it("spawns the located program with the agy arguments", async () => {
    const cmd = await adapter.command({
      ...opts,
      dangerous: true,
      resume: UUID,
    });
    expect(cmd).toEqual({
      file: "C:/x/agy.exe",
      args: antigravityArgs({
        dangerous: true,
        resume: UUID,
        hooksRoot: opts.hooksRoot,
      }),
    });
    expect(cmd?.args).not.toContain("--model");
  });

  it("gives null when agy is not found", async () => {
    const missing = createAntigravityAdapter({ locate: async () => null });
    expect(await missing.command(opts)).toBeNull();
  });

  it("passes enrich and trusted through, and has none by default", () => {
    const enrich = async (raw: Record<string, unknown>) => raw;
    const trusted = async () => true;
    const full = createAntigravityAdapter({
      locate: async () => null,
      enrich,
      trusted,
    });
    expect(full.enrich).toBe(enrich);
    expect(full.trusted).toBe(trusted);
    expect(adapter.enrich).toBeUndefined();
    expect(adapter.trusted).toBeUndefined();
  });
});
