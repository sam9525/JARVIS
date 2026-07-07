import path from "node:path";
import type { ToolEvent } from "../shared/types";

export interface RawHookEvent {
  session_id?: string;
  cwd?: string;
  hook_event_name?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  // tool_response exists on PostToolUse but v1 never reads it (tech-spec lock)
}

// Emits exactly the three combos the graph reacts to
// (spec "Pre vs Post → graph reaction" table); everything else → null.
export function mapHookEvent(raw: RawHookEvent): ToolEvent | null {
  if (!raw.session_id || !raw.cwd) return null;
  const phase =
    raw.hook_event_name === "PreToolUse"
      ? ("pre" as const)
      : raw.hook_event_name === "PostToolUse"
        ? ("post" as const)
        : null;
  if (!phase) return null;
  const input = raw.tool_input ?? {};
  const common = { sessionId: raw.session_id, phase, ts: Date.now() };

  if (
    phase === "pre" &&
    (raw.tool_name === "Grep" || raw.tool_name === "Glob")
  ) {
    return {
      ...common,
      tool: raw.tool_name,
      nodeIds: [],
      pattern: String(input.pattern ?? ""),
    };
  }
  if (phase === "pre" && raw.tool_name === "Read") {
    const nodeId = toNode(raw.cwd, input.file_path);
    return nodeId ? { ...common, tool: "Read", nodeIds: [nodeId] } : null;
  }
  if (
    phase === "post" &&
    (raw.tool_name === "Edit" || raw.tool_name === "Write")
  ) {
    const nodeId = toNode(raw.cwd, input.file_path);
    return nodeId
      ? { ...common, tool: raw.tool_name, nodeIds: [nodeId] }
      : null;
  }
  return null;
}

function toNode(cwd: string, filePath: unknown): string | null {
  if (typeof filePath !== "string" || !/\.md$/i.test(filePath)) return null;
  const absPath = path.isAbsolute(filePath)
    ? filePath
    : path.resolve(cwd, filePath);
  const rel = path.relative(cwd, absPath);
  if (rel.startsWith("..") || path.isAbsolute(rel)) return null; // outside workspace
  return rel.split(path.sep).join("/").replace(/\.md$/i, "");
}
