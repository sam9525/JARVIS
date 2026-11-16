import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  codexHookFlags,
  createCodexAdapter,
} from "../../../src/main/agents/codex";
import type { RawHookEvent } from "../../../src/main/event-mapper";
import { mapStatusEvent } from "../../../src/main/status-mapper";
import { buildWorkspaces } from "../../../src/main/workspaces";

const UUID = "01a1df64-396f-7b43-ac5b-879d211c3ee2";
const SANDBOX_FLAG = "--dangerously-bypass-approvals-and-sandbox";

const fixture = (name: string): Record<string, unknown> =>
  JSON.parse(
    readFileSync(
      path.join(__dirname, "..", "..", "fixtures", "codex", `${name}.json`),
      "utf8",
    ),
  );

const adapter = createCodexAdapter(async () => "C:/x/codex.exe");
const normalize = (name: string) => {
  const out = adapter.normalize({
    ...fixture(name),
    jarvis_session: "c:/work/demo#2",
    jarvis_sent_at: 1,
    jarvis_agent: "codex",
  });
  for (const payload of out) {
    expect(payload).not.toHaveProperty("transcript_path");
    expect(payload.session_id).toBe(UUID);
    expect(payload.cwd).toBe("C:\\work\\demo");
    expect(payload.jarvis_session).toBe("c:/work/demo#2");
    expect(payload.jarvis_sent_at).toBe(1);
    expect(payload.jarvis_agent).toBe("codex");
  }
  return out;
};
const pick = (out: RawHookEvent[]) =>
  out.map(({ hook_event_name, tool_name, tool_input }) => ({
    hook_event_name,
    tool_name,
    tool_input,
  }));

describe("codex normalize", () => {
  it("drops SessionStart", () => {
    expect(normalize("session-start")).toEqual([]);
    expect(normalize("session-start-resume")).toEqual([]);
  });

  it("keeps the prompt of UserPromptSubmit", () => {
    const [out, ...rest] = normalize("user-prompt");
    expect(rest).toEqual([]);
    expect(out.hook_event_name).toBe("UserPromptSubmit");
    expect(out.prompt).toBe(fixture("user-prompt").prompt);
  });

  it("turns a shell read into a Read of an absolute path", () => {
    expect(pick(normalize("pre-bash-read"))).toEqual([
      {
        hook_event_name: "PreToolUse",
        tool_name: "Read",
        tool_input: { file_path: "C:/work/demo/README.md" },
      },
    ]);
  });

  it("turns a shell search into a Grep", () => {
    expect(pick(normalize("pre-bash-search"))).toEqual([
      {
        hook_event_name: "PreToolUse",
        tool_name: "Grep",
        tool_input: { pattern: "greet" },
      },
    ]);
  });

  it("passes a shell command it cannot read through as Bash", () => {
    const raw = {
      ...fixture("pre-bash-read"),
      tool_input: { command: "npm test" },
    };
    expect(pick(adapter.normalize(raw))).toEqual([
      {
        hook_event_name: "PreToolUse",
        tool_name: "Bash",
        tool_input: { command: "npm test" },
      },
    ]);
  });

  it("passes any other tool through unchanged", () => {
    expect(pick(normalize("pre-other"))).toEqual([
      {
        hook_event_name: "PreToolUse",
        tool_name: "mcp__node_repl__js",
        tool_input: fixture("pre-other").tool_input,
      },
    ]);
  });

  it("turns a patch into Edit and Write with / paths", () => {
    expect(pick(normalize("post-apply-patch"))).toEqual([
      {
        hook_event_name: "PostToolUse",
        tool_name: "Edit",
        tool_input: { file_path: "C:/work/demo/greet.js" },
      },
    ]);
    const added = adapter.normalize({
      ...fixture("post-apply-patch"),
      tool_input: {
        command:
          "*** Begin Patch\n*** Add File: \\\\?\\C:\\work\\demo\\new.js\n+x\n*** Add File: lib/b.js\n+y\n*** End Patch",
      },
    });
    expect(pick(added)).toEqual([
      {
        hook_event_name: "PostToolUse",
        tool_name: "Write",
        tool_input: { file_path: "C:/work/demo/new.js" },
      },
      {
        hook_event_name: "PostToolUse",
        tool_name: "Write",
        tool_input: { file_path: "C:/work/demo/lib/b.js" },
      },
    ]);
  });

  it("keeps the response of a gitnexus impact call", () => {
    const [out] = adapter.normalize({
      ...fixture("post-apply-patch"),
      tool_name: "mcp__gitnexus__impact",
      tool_input: { target: "x" },
      tool_response: { content: [] },
    });
    expect(out).toMatchObject({
      hook_event_name: "PostToolUse",
      tool_name: "mcp__gitnexus__impact",
      tool_input: { target: "x" },
      tool_response: { content: [] },
    });
  });

  it("turns request_user_input into AskUserQuestion with no questions", () => {
    expect(pick(normalize("pre-request-user-input"))).toEqual([
      {
        hook_event_name: "PreToolUse",
        tool_name: "AskUserQuestion",
        tool_input: {},
      },
    ]);
    const post = normalize("post-request-user-input");
    expect(pick(post)).toEqual([
      {
        hook_event_name: "PostToolUse",
        tool_name: "AskUserQuestion",
        tool_input: {},
      },
    ]);
    expect(post[0]).not.toHaveProperty("tool_response");
  });

  it("turns PermissionRequest and Interrupt into Notifications", () => {
    expect(normalize("permission-request")).toEqual([
      expect.objectContaining({
        hook_event_name: "Notification",
        notification_type: "permission_prompt",
      }),
    ]);
    expect(normalize("interrupt")).toEqual([
      expect.objectContaining({
        hook_event_name: "Notification",
        notification_type: "idle_prompt",
      }),
    ]);
  });

  it("keeps the last message of Stop, also when it is null", () => {
    const [out] = normalize("stop");
    expect(out.hook_event_name).toBe("Stop");
    expect(out.last_assistant_message).toBe(
      fixture("stop").last_assistant_message,
    );
    const [nulled] = adapter.normalize({
      ...fixture("stop"),
      last_assistant_message: null,
    });
    expect(nulled.last_assistant_message).toBeNull();
  });

  it("gives nothing for an empty or unknown body", () => {
    expect(adapter.normalize({})).toEqual([]);
    expect(adapter.normalize({ hook_event_name: "Nope" })).toEqual([]);
  });

  it("never throws on odd field types", () => {
    const odd = {
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      tool_input: "cat a.ts",
      cwd: 5,
    };
    expect(() => adapter.normalize(odd)).not.toThrow();
    expect(() =>
      adapter.normalize({
        ...odd,
        hook_event_name: "PostToolUse",
        tool_name: "apply_patch",
      }),
    ).not.toThrow();
  });
});

describe("codex normalize through the status mapper", () => {
  const workspaces = buildWorkspaces("D:\\vault", [
    { name: "demo", path: "C:\\work\\demo" },
  ]);
  const status = (name: string) =>
    mapStatusEvent(normalize(name)[0], workspaces);

  it("reads working, blocked and finished", () => {
    expect(status("pre-bash-read")?.kind).toBe("working");
    expect(status("permission-request")?.kind).toBe("blocked");
    const stop = status("stop");
    expect(stop?.kind).toBe("idle");
    expect(stop && "ended" in stop && stop.ended).toBe("finished");
  });
});

describe("codex command", () => {
  const opts = {
    dangerous: false,
    resume: false as boolean | string,
    forwardPath: "C:\\app\\src\\hook\\forward.mjs",
  };

  it("spawns the located program with hook flags only", async () => {
    const cmd = await adapter.command({ ...opts, model: "opus" });
    expect(cmd?.file).toBe("C:/x/codex.exe");
    expect(cmd?.args).not.toContain("--model");
    expect(cmd?.args).not.toContain("--dangerously-bypass-hook-trust");
    expect(cmd?.args).not.toContain(SANDBOX_FLAG);
    expect(cmd?.args).toEqual(codexHookFlags(opts.forwardPath, true));
  });

  it("adds the sandbox flag when dangerous", async () => {
    const cmd = await adapter.command({ ...opts, dangerous: true });
    expect(cmd?.args[0]).toBe(SANDBOX_FLAG);
  });

  it("resumes a session id and ignores anything else", async () => {
    const byId = await adapter.command({ ...opts, resume: UUID });
    const args = byId?.args ?? [];
    expect(args.slice(-2)).toEqual(["resume", UUID]);
    expect(args.lastIndexOf("-c")).toBeLessThan(args.indexOf("resume"));
    const dangerous = await adapter.command({
      ...opts,
      dangerous: true,
      resume: UUID,
    });
    expect(dangerous?.args[0]).toBe(SANDBOX_FLAG);
    expect(dangerous?.args.slice(-2)).toEqual(["resume", UUID]);
    for (const resume of ["a & b", true]) {
      const cmd = await adapter.command({ ...opts, resume });
      expect(cmd?.args).not.toContain("resume");
    }
  });

  it("gives null when codex is not found", async () => {
    const missing = createCodexAdapter(async () => null);
    expect(await missing.command(opts)).toBeNull();
  });
});

describe("codexHookFlags", () => {
  const flags = codexHookFlags("C:\\app\\hook\\forward.mjs", true);
  const values = flags.filter((_, i) => i % 2 === 1);

  it("gives one -c pair per event", () => {
    expect(flags.filter((_, i) => i % 2 === 0).every((f) => f === "-c")).toBe(
      true,
    );
    expect(values.map((v) => v.slice(0, v.indexOf("=")))).toEqual([
      "hooks.SessionStart",
      "hooks.UserPromptSubmit",
      "hooks.PreToolUse",
      "hooks.PostToolUse",
      "hooks.PermissionRequest",
      "hooks.Stop",
      "hooks.Interrupt",
    ]);
  });

  it("uses the recorded TOML quoting with / paths", () => {
    expect(values[2]).toBe(
      'hooks.PreToolUse=[{matcher="*",hooks=[{type="command",command="node \\"C:/app/hook/forward.mjs\\""}]}]',
    );
    expect(values[3]).toContain(
      'matcher="apply_patch|mcp__gitnexus__impact|request_user_input"',
    );
    // The only backslashes are the TOML escapes of the quotes around the path.
    for (const value of values)
      expect(value.replaceAll('\\"', "")).not.toContain("\\");
  });

  it("leaves out Interrupt when asked", () => {
    expect(codexHookFlags("a", false).join(" ")).not.toContain("Interrupt");
  });
});
