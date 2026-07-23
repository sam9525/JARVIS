import path from "node:path";
import type { ToolEvent, Workspace } from "../shared/types";
import { resolveWorkspace } from "./workspaces";
import { extractPaths } from "./response-paths";

export interface RawHookEvent {
  session_id?: string;
  cwd?: string;
  hook_event_name?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  tool_response?: unknown; // PostToolUse only; read solely for the Grep/Glob match highlight
  notification_type?: string; // Notification only; read by status-mapper.ts
  last_assistant_message?: string; // Stop only; the final assistant text of the turn
}

// A broad search can match hundreds of files; past this the graph is a white
// screen, not a signal. First-N in response order (≈ relevance order for Grep).
export const MATCH_CAP = 40;

// Emits exactly the combos the graph reacts to; everything else → null.
// Events route to the workspace whose root is the longest prefix of cwd.
export function mapHookEvent(
  raw: RawHookEvent,
  workspaces: Workspace[],
): ToolEvent | null {
  if (!raw.session_id || !raw.cwd) return null;
  const ws = resolveWorkspace(workspaces, raw.cwd);
  if (!ws) return null; // Claude running somewhere we don't track
  const common = {
    sessionId: raw.session_id,
    workspaceId: ws.id,
    ts: Date.now(),
  };

  if (raw.hook_event_name === "UserPromptSubmit") {
    // new question — the renderer resets that workspace's highlights/trail
    return { ...common, phase: "pre", tool: "Prompt", nodeIds: [] };
  }
  const phase =
    raw.hook_event_name === "PreToolUse"
      ? ("pre" as const)
      : raw.hook_event_name === "PostToolUse"
        ? ("post" as const)
        : null;
  if (!phase) return null;
  const input = raw.tool_input ?? {};

  if (
    phase === "pre" &&
    (raw.tool_name === "Grep" || raw.tool_name === "Glob")
  ) {
    return {
      ...common,
      phase,
      tool: raw.tool_name,
      nodeIds: [],
      pattern: String(input.pattern ?? ""),
    };
  }
  if (
    phase === "post" &&
    (raw.tool_name === "Grep" || raw.tool_name === "Glob")
  ) {
    const nodeIds: string[] = [];
    const seen = new Set<string>();
    for (const p of extractPaths(raw.tool_response)) {
      const nodeId = toNode(ws, raw.cwd, p);
      if (!nodeId || seen.has(nodeId)) continue;
      seen.add(nodeId);
      nodeIds.push(nodeId);
      if (nodeIds.length === MATCH_CAP) break;
    }
    return nodeIds.length
      ? {
          ...common,
          phase,
          tool: raw.tool_name,
          nodeIds,
          pattern: String(input.pattern ?? ""),
        }
      : null;
  }
  if (phase === "pre" && raw.tool_name === "Read") {
    const nodeId = toNode(ws, raw.cwd, input.file_path);
    return nodeId
      ? { ...common, phase, tool: "Read", nodeIds: [nodeId] }
      : null;
  }
  if (
    phase === "post" &&
    (raw.tool_name === "Edit" || raw.tool_name === "Write")
  ) {
    const nodeId = toNode(ws, raw.cwd, input.file_path);
    return nodeId
      ? { ...common, phase, tool: raw.tool_name, nodeIds: [nodeId] }
      : null;
  }
  return null;
}

// vault: node id = root-relative POSIX path without .md (non-.md → drop).
// code: node id = root-relative POSIX path, extension kept.
function toNode(ws: Workspace, cwd: string, filePath: unknown): string | null {
  if (typeof filePath !== "string") return null;
  const absPath = path.isAbsolute(filePath)
    ? filePath
    : path.resolve(cwd, filePath);
  const rel = path.relative(ws.rootPath, absPath);
  if (rel.startsWith("..") || path.isAbsolute(rel)) return null; // outside workspace
  const posix = rel.split(path.sep).join("/");
  if (ws.kind === "vault") {
    return /\.md$/i.test(posix) ? posix.replace(/\.md$/i, "") : null;
  }
  return posix;
}
