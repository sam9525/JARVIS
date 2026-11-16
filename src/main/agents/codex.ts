import { posix } from "node:path";
import type { AgentAdapter } from ".";
import type { RawHookEvent } from "../event-mapper";
import { isSessionId } from "../../shared/session-id";
import { parsePatch } from "./patch-paths";
import { parseShellCommand } from "./shell-reads";

// Codex accepts an Interrupt hook, so the hook is registered.
const WITH_INTERRUPT = true;

const MATCHERS: [event: string, matcher: string][] = [
  ["SessionStart", "*"],
  ["UserPromptSubmit", "*"],
  ["PreToolUse", "*"],
  ["PostToolUse", "apply_patch|mcp__gitnexus__impact|request_user_input"],
  ["PermissionRequest", "*"],
  ["Stop", "*"],
  ["Interrupt", "*"],
];

/** `-c` pairs that register forward.mjs for each Codex hook event. The path
 * uses `/` because `\` starts an escape in a TOML string. */
export function codexHookFlags(
  forwardPath: string,
  withInterrupt: boolean,
): string[] {
  const script = forwardPath.replace(/\\/g, "/");
  return MATCHERS.filter(
    ([event]) => withInterrupt || event !== "Interrupt",
  ).flatMap(([event, matcher]) => [
    "-c",
    `hooks.${event}=[{matcher="${matcher}",hooks=[{type="command",command="node \\"${script}\\""}]}]`,
  ]);
}

const PASSED_FIELDS = [
  "session_id",
  "cwd",
  "jarvis_session",
  "jarvis_sent_at",
  "jarvis_agent",
] as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

// A `\\?\` prefix (resumed sessions) is dropped, and a relative path is joined to cwd.
function filePathOf(raw: string, cwd: unknown): string {
  const slashed = raw.replace(/^\\\\\?\\/, "").replace(/\\/g, "/");
  const absolute = /^[A-Za-z]:/.test(slashed) || slashed.startsWith("/");
  if (absolute || typeof cwd !== "string") return slashed;
  return posix.join(cwd.replace(/\\/g, "/"), slashed);
}

function normalizeCodex(raw: Record<string, unknown>): RawHookEvent[] {
  const base: Record<string, unknown> = {};
  for (const field of PASSED_FIELDS)
    if (raw[field] !== undefined) base[field] = raw[field];
  const event = raw.hook_event_name;
  const toolName = raw.tool_name;
  const toolInput = isRecord(raw.tool_input) ? raw.tool_input : {};
  const payload = (fields: Record<string, unknown>) =>
    ({ ...base, hook_event_name: event, ...fields }) as RawHookEvent;
  const perPath = (tool: string, paths: string[]) =>
    paths.map((p) =>
      payload({
        tool_name: tool,
        tool_input: { file_path: filePathOf(p, raw.cwd) },
      }),
    );

  switch (event) {
    case "UserPromptSubmit":
      return [payload({ prompt: raw.prompt })];
    case "Stop":
      // A null message comes before Codex's unhooked plan choice, which waits on the user.
      if (raw.last_assistant_message === null)
        return [
          payload({
            hook_event_name: "Notification",
            notification_type: "permission_prompt",
          }),
        ];
      return [payload({ last_assistant_message: raw.last_assistant_message })];
    case "PermissionRequest":
      return [
        payload({
          hook_event_name: "Notification",
          notification_type: "permission_prompt",
        }),
      ];
    case "Interrupt":
      return [
        payload({
          hook_event_name: "Notification",
          notification_type: "idle_prompt",
        }),
      ];
    case "PreToolUse":
    case "PostToolUse": {
      // The Codex answer shape is not Claude's, so the response is dropped.
      if (toolName === "request_user_input")
        return [payload({ tool_name: "AskUserQuestion", tool_input: {} })];
      if (event === "PreToolUse" && toolName === "Bash") {
        const { reads, searches } = parseShellCommand(toolInput.command);
        const out = [
          ...perPath("Read", reads),
          ...searches.map((pattern) =>
            payload({ tool_name: "Grep", tool_input: { pattern } }),
          ),
        ];
        if (out.length > 0) return out;
      }
      if (event === "PostToolUse" && toolName === "apply_patch") {
        const { edited, added } = parsePatch(toolInput.command);
        return [...perPath("Edit", edited), ...perPath("Write", added)];
      }
      return [
        payload({
          tool_name: toolName,
          tool_input: toolInput,
          ...(raw.tool_response !== undefined
            ? { tool_response: raw.tool_response }
            : {}),
        }),
      ];
    }
    default:
      return [];
  }
}

export function createCodexAdapter(
  locate: () => Promise<string | null>,
): AgentAdapter {
  return {
    id: "codex",
    features: {
      transcript: false,
      askPanel: false,
      permissionCard: false,
      statusLine: false,
      slashList: false,
      trustCheck: false,
      resume: true,
    },
    // codex.exe is a real program, spawned directly so no shell parses the -c values.
    command: async ({ dangerous, resume, forwardPath }) => {
      const file = await locate();
      if (file === null) return null;
      // the flags go before the `resume <id>` subcommand
      const args = [
        ...(dangerous ? ["--dangerously-bypass-approvals-and-sandbox"] : []),
        // without it Codex holds the session on its "Hooks need review" screen
        "--dangerously-bypass-hook-trust",
        ...codexHookFlags(forwardPath, WITH_INTERRUPT),
        ...(typeof resume === "string" && isSessionId(resume)
          ? ["resume", resume]
          : []),
      ];
      return { file, args };
    },
    prepare: async () => true,
    normalize: normalizeCodex,
  };
}
