export type ToolName = "Read" | "Grep" | "Glob" | "Edit" | "Write";

export interface ToolEvent {
  sessionId: string;
  phase: "pre" | "post";
  tool: ToolName;
  // vault-relative POSIX path without .md; v1 emits 0 or 1 entries.
  // Stays an array for Phase 2 multi-file matches — free.
  nodeIds: string[];
  pattern?: string; // Grep/Glob only
  ts: number;
}

export interface GraphNode {
  // note: vault-relative POSIX path without .md; tag: "tag:<name>"
  id: string;
  type: "note" | "tag";
}

export interface GraphEdge {
  source: string;
  target: string;
}

export interface VaultGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface Workspace {
  id: string;
  name: string;
  rootPath: string;
}

export interface Session {
  id: string;
  workspaceId: string;
  startedAt: number;
}
