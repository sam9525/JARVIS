import { resolveSessionKey, type RawHookEvent } from "./event-mapper";
import type { Workspace } from "../shared/types";
import { parseTextQuestion } from "../shared/text-question";
import { resolveWorkspace } from "./workspaces";
import type { AskPrompt } from "./ask-mapper";

// Fifth independent reader of the hook payload: a Stop whose reply ends on a
// plain-text question becomes a prompt for the same panel AskUserQuestion uses.
export function mapTextQuestion(
  raw: RawHookEvent,
  workspaces: Workspace[],
): AskPrompt | undefined {
  if (raw.hook_event_name !== "Stop") return undefined;
  if (!raw.session_id || !raw.cwd) return undefined;
  const ws = resolveWorkspace(workspaces, raw.cwd);
  if (!ws || ws.isSelf) return undefined;
  const message =
    typeof raw.last_assistant_message === "string"
      ? raw.last_assistant_message
      : "";
  const parsed = parseTextQuestion(message);
  if (!parsed) return undefined;
  return {
    workspaceId: ws.id,
    sessionKey: resolveSessionKey(raw, ws),
    sessionId: raw.session_id,
    source: "text",
    ts: Date.now(),
    questions: [
      {
        question: parsed.question,
        header: "",
        multiSelect: false,
        options: parsed.options.map((o) => ({
          label: o.label,
          description: o.description,
          reply: o.reply,
        })),
      },
    ],
  };
}
