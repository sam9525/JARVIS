import type { ScreenEntry } from "../shared/screen-types";

export const SKIPPED_TYPES: readonly string[] = [
  "attachment",
  "api-request",
  "api-request-blob",
  "api-request-shape",
  "mode",
  "atis-latch",
  "file-history-snapshot",
  "file-history-delta",
  "last-prompt",
  "ai-title",
  "queue-operation",
  "cost-state",
  "permission-mode",
  "artifact-comment-monitor",
  "artifact-autoreact-ledger",
  "summary",
  "bridge-session",
];

const RESULT_TEXT_LIMIT = 4000;
const PATCH_LINE_LIMIT = 200;
const SILENT_SYSTEM_SUBTYPES = [
  "turn_duration",
  "stop_hook_summary",
  "informational",
  "away_summary",
];

type Json = Record<string, unknown>;

const asRecord = (value: unknown): Json | null =>
  typeof value === "object" && value !== null ? (value as Json) : null;

const tagBody = (text: string, tag: string): string | null => {
  const match = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(text);
  return match ? match[1] : null;
};

const stripTags = (text: string): string => text.replace(/<[^>]+>/g, "").trim();

function parsePromptText(id: string, text: string): ScreenEntry[] {
  if (text.includes("<local-command-caveat>")) return [];
  if (text.startsWith("[Request interrupted by user"))
    return [{ kind: "notice", id, text: "Interrupted" }];
  const stdout = tagBody(text, "local-command-stdout");
  if (stdout !== null) {
    const body = stdout.trim();
    return body === "" ? [] : [{ kind: "notice", id, text: body }];
  }
  const command = tagBody(text, "command-name");
  if (command !== null) {
    const args = tagBody(text, "command-args")?.trim() ?? "";
    return [
      {
        kind: "prompt",
        id,
        text: args === "" ? command.trim() : `${command.trim()} ${args}`,
      },
    ];
  }
  return [{ kind: "prompt", id, text }];
}

function flattenContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block) => {
      const rec = asRecord(block);
      return rec && typeof rec.text === "string" ? rec.text : "";
    })
    .filter((part) => part !== "")
    .join("\n");
}

function patchOf(toolUseResult: unknown): string[] | undefined {
  const result = asRecord(toolUseResult);
  if (!result) return undefined;
  if (Array.isArray(result.structuredPatch)) {
    const lines = result.structuredPatch.flatMap((hunk) => {
      const hunkLines = asRecord(hunk)?.lines;
      return Array.isArray(hunkLines) ? hunkLines.map(String) : [];
    });
    return lines.length === 0 ? undefined : lines.slice(0, PATCH_LINE_LIMIT);
  }
  if (result.type === "create" && typeof result.content === "string") {
    return result.content
      .split("\n")
      .slice(0, PATCH_LINE_LIMIT)
      .map((line) => `+${line}`);
  }
  return undefined;
}

function arrayPromptText(content: unknown[]): string {
  return content
    .map((block) => {
      const rec = asRecord(block);
      if (rec?.type === "text") return String(rec.text ?? "");
      return rec?.type === "image" ? "[image]" : "";
    })
    .filter((part) => part !== "")
    .join("\n");
}

const TASK_OPEN = "<task-notification>";

function parseTask(id: string, text: string): ScreenEntry {
  const status = tagBody(text, "status")?.trim() ?? "";
  const summary = tagBody(text, "summary")?.trim() ?? "";
  const fallback =
    status === "" ? "Background task" : `Background task ${status}`;
  return {
    kind: "task",
    id,
    summary: summary !== "" ? summary : fallback,
    failed: status === "failed",
    full: text,
  };
}

function parseUser(line: Json, id: string): ScreenEntry[] {
  if (line.isMeta === true || line.isSidechain === true) return [];
  if (line.isCompactSummary === true)
    return [{ kind: "notice", id, text: "Conversation compacted" }];
  const content = asRecord(line.message)?.content;
  if (typeof content === "string") {
    const text = content.trim();
    // A human-typed message can quote or open with a block; only the system's own is a task.
    if (text.startsWith(TASK_OPEN) && asRecord(line.origin)?.kind !== "human") {
      return [parseTask(id, text)];
    }
    return parsePromptText(id, content);
  }
  if (!Array.isArray(content)) return [];
  if (!content.some((block) => asRecord(block)?.type === "tool_result")) {
    return parsePromptText(id, arrayPromptText(content));
  }
  const patch = patchOf(line.toolUseResult);
  const entries: ScreenEntry[] = [];
  for (const block of content) {
    const rec = asRecord(block);
    if (!rec || rec.type !== "tool_result") continue;
    const entry: ScreenEntry = {
      kind: "result",
      toolUseId: String(rec.tool_use_id ?? ""),
      isError: rec.is_error === true,
      text: flattenContent(rec.content).slice(0, RESULT_TEXT_LIMIT),
    };
    if (patch) entry.patch = patch;
    entries.push(entry);
  }
  return entries;
}

function parseAssistant(line: Json, id: string): ScreenEntry[] {
  if (line.isSidechain === true) return [];
  const content = asRecord(line.message)?.content;
  if (!Array.isArray(content)) return [];
  const entries: ScreenEntry[] = [];
  for (const block of content) {
    const rec = asRecord(block);
    if (!rec) continue;
    switch (rec.type) {
      case "text":
        entries.push({ kind: "text", id, markdown: String(rec.text ?? "") });
        break;
      case "thinking":
      case "redacted_thinking":
        entries.push({ kind: "thinking", id });
        break;
      case "tool_use":
        entries.push({
          kind: "tool",
          id: String(rec.id ?? id),
          name: String(rec.name ?? ""),
          input: asRecord(rec.input) ?? {},
        });
        break;
      default:
        entries.push({ kind: "unknown", id, label: String(rec.type ?? "") });
    }
  }
  // Entries of one line share its uuid; the index keeps their ids distinct.
  if (entries.length > 1) {
    return entries.map((entry, index) =>
      entry.kind === "tool" || entry.kind === "result"
        ? entry
        : { ...entry, id: `${id}#${index}` },
    );
  }
  return entries;
}

function parseSystem(line: Json, id: string): ScreenEntry[] {
  const subtype = String(line.subtype ?? "");
  if (subtype === "local_command") {
    const body = stripTags(String(line.content ?? ""));
    return body === "" ? [] : [{ kind: "notice", id, text: body }];
  }
  if (subtype === "compact_boundary")
    return [{ kind: "notice", id, text: "Conversation compacted" }];
  if (SILENT_SYSTEM_SUBTYPES.includes(subtype)) return [];
  return [{ kind: "unknown", id, label: subtype }];
}

const skipString = (line: string, quote: number): number => {
  let i = quote + 1;
  while (i < line.length && line[i] !== '"') i += line[i] === "\\" ? 2 : 1;
  return i;
};

const skipSpace = (line: string, from: number): number => {
  let i = from;
  while (i < line.length && /\s/.test(line[i])) i++;
  return i;
};

// Nested objects (an assistant `message`, an `attachment`) carry their own
// "type" ahead of the line's, so only a key at depth 1 counts.
function topLevelType(line: string): string | undefined {
  let depth = 0;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === "{" || ch === "[") depth++;
    else if (ch === "}" || ch === "]") depth--;
    else if (ch === '"') {
      const end = skipString(line, i);
      const colon = skipSpace(line, end + 1);
      if (
        depth === 1 &&
        line.slice(i, end + 1) === '"type"' &&
        line[colon] === ":"
      ) {
        const value = skipSpace(line, colon + 1);
        if (line[value] !== '"') return undefined;
        return line.slice(value + 1, skipString(line, value));
      }
      i = end;
    }
  }
  return undefined;
}

/** Turns one transcript `.jsonl` line into zero or more screen entries; a broken line yields none. */
export function parseTranscriptLine(line: string): ScreenEntry[] {
  const type = topLevelType(line);
  if (type === undefined || SKIPPED_TYPES.includes(type)) return [];
  let parsed: Json | null;
  try {
    parsed = asRecord(JSON.parse(line));
  } catch {
    return [];
  }
  if (!parsed) return [];
  const id = String(parsed.uuid ?? "");
  switch (type) {
    case "user":
      return parseUser(parsed, id);
    case "assistant":
      return parseAssistant(parsed, id);
    case "system":
      return parseSystem(parsed, id);
    default:
      return [{ kind: "unknown", id, label: type }];
  }
}
