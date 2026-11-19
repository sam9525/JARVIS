import type { AgentAdapter } from ".";
import type { RawHookEvent } from "../event-mapper";
import { antigravityArgs, ensureAntigravityHooks } from "./antigravity-hooks";
import { filePathOf } from "./hook-path";
import { parseShellCommand } from "./shell-reads";

const PASSED_FIELDS = [
  "cwd",
  "jarvis_session",
  "jarvis_sent_at",
  "jarvis_agent",
] as const;

// Only after the tool ran is the file changed; before, the call passes through.
const WRITE_TOOLS: Record<string, string> = {
  edit_file: "Edit",
  write_file: "Write",
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isFirstPrompt = (raw: Record<string, unknown>) =>
  raw.hookEventName === "PreInvocation" && raw.invocationNum === 0;

const isCancelledStop = (raw: Record<string, unknown>) =>
  raw.hookEventName === "Stop" && raw.terminationReason === "USER_CANCELED";

function normalizeStop(
  raw: Record<string, unknown>,
  payload: (fields: Record<string, unknown>) => RawHookEvent,
): RawHookEvent[] {
  if (isCancelledStop(raw))
    return [
      payload({
        hook_event_name: "Notification",
        notification_type: "idle_prompt",
      }),
    ];
  const error = typeof raw.error === "string" ? raw.error : "";
  const reason = raw.terminationReason;
  if (error !== "" || (reason !== undefined && reason !== "NO_TOOL_CALL"))
    return [
      payload({
        hook_event_name: "StopFailure",
        error: error || String(reason),
      }),
    ];
  const message = raw.lastAssistantMessage;
  return [
    payload({
      last_assistant_message: typeof message === "string" ? message : "",
    }),
  ];
}

function normalizeAntigravity(raw: Record<string, unknown>): RawHookEvent[] {
  const event = raw.hookEventName;
  if (typeof event !== "string") return [];
  const base: Record<string, unknown> =
    raw.conversationId === undefined ? {} : { session_id: raw.conversationId };
  for (const field of PASSED_FIELDS)
    if (raw[field] !== undefined) base[field] = raw[field];
  const payload = (fields: Record<string, unknown>) =>
    ({ ...base, hook_event_name: event, ...fields }) as RawHookEvent;

  switch (event) {
    case "PreInvocation":
      return isFirstPrompt(raw)
        ? [
            payload({
              hook_event_name: "UserPromptSubmit",
              prompt: raw.lastUserInput,
            }),
          ]
        : [];
    case "Stop":
      return normalizeStop(raw, payload);
    case "PreToolUse":
    case "PostToolUse": {
      const call = raw.toolCall;
      if (!isRecord(call) || typeof call.name !== "string") return [];
      const args = isRecord(call.args) ? call.args : {};
      const filePath =
        typeof args.Path === "string" ? filePathOf(args.Path, raw.cwd) : null;
      const tool = (name: string, input: Record<string, unknown>) =>
        payload({ tool_name: name, tool_input: input });

      if (call.name === "read_file" && filePath !== null)
        return [tool("Read", { file_path: filePath })];
      const writeTool = WRITE_TOOLS[call.name];
      if (event === "PostToolUse" && writeTool && filePath !== null)
        return [tool(writeTool, { file_path: filePath })];
      if (call.name === "run_command") {
        const command = args.CommandLine;
        if (event === "PreToolUse") {
          const { reads, searches } = parseShellCommand(command);
          const out = [
            ...reads.map((p) =>
              tool("Read", { file_path: filePathOf(p, raw.cwd) }),
            ),
            ...searches.map((pattern) => tool("Grep", { pattern })),
          ];
          if (out.length > 0) return out;
        }
        return [tool("Bash", { command })];
      }
      return [tool(call.name, args)];
    }
    default:
      return [];
  }
}

// The ready gate counts a turn from the first model call and ends it on Esc's Stop.
function antigravityGateEvent(
  raw: Record<string, unknown>,
): string | undefined {
  if (typeof raw.hookEventName !== "string") return undefined;
  if (isFirstPrompt(raw)) return "UserPromptSubmit";
  if (isCancelledStop(raw)) return "Interrupt";
  return raw.hookEventName;
}

export function createAntigravityAdapter(deps: {
  locate(): Promise<string | null>;
  enrich?: AgentAdapter["enrich"];
  trusted?: AgentAdapter["trusted"];
}): AgentAdapter {
  return {
    id: "antigravity",
    features: {
      transcript: false,
      askPanel: false,
      permissionCard: false,
      statusLine: false,
      slashList: false,
      trustCheck: false,
      resume: true,
    },
    // agy.exe is a real program, spawned directly so no shell parses the --settings JSON.
    command: async ({ dangerous, resume, hooksRoot }) => {
      const file = await deps.locate();
      if (file === null) return null;
      return { file, args: antigravityArgs({ dangerous, resume, hooksRoot }) };
    },
    prepare: (ctx) => ensureAntigravityHooks(ctx.hooksRoot, ctx.forwardPath),
    normalize: normalizeAntigravity,
    gateEvent: antigravityGateEvent,
    ...(deps.enrich ? { enrich: deps.enrich } : {}),
    ...(deps.trusted ? { trusted: deps.trusted } : {}),
  };
}
