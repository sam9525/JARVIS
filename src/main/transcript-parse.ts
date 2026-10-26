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
    return lines.slice(0, PATCH_LINE_LIMIT);
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

function parseUser(line: Json, id: string): ScreenEntry[] {
  if (line.isMeta === true || line.isSidechain === true) return [];
  const content = asRecord(line.message)?.content;
  if (typeof content === "string") return parsePromptText(id, content);
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

/** Turns one transcript `.jsonl` line into zero or more screen entries; a broken line yields none. */
export function parseTranscriptLine(line: string): ScreenEntry[] {
  const type = /"type":"([^"]+)"/.exec(line)?.[1];
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
