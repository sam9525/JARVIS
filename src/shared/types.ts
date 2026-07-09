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

export type Section = "raw" | "wiki";
export type SectionFilter = Section | "both";

export interface GraphNode {
  // note: vault-relative POSIX path without .md; tag: "tag:<name>"
  id: string;
  type: "note" | "tag";
  domain?: string; // note nodes only: top-level vault folder name
  section?: Section; // note nodes only
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

export interface GraphGroup {
  query: string; // case-insensitive substring matched against node id (path)
  color: string; // "#rrggbb"
}

export interface Settings {
  sectionFilter: SectionFilter;
  showTags: boolean;
  showOrphans: boolean;
  groups: GraphGroup[]; // first matching group wins
  display: {
    textFadeThreshold: number; // hide labels drawn smaller than this (screen px)
    nodeSize: number; // multiplier on degree-based radius
    linkThickness: number; // multiplier on link width
  };
  forces: {
    centerStrength: number;
    repelStrength: number; // applied as charge strength -repelStrength
    linkStrength: number; // multiplier on d3's per-link default
    linkDistance: number;
  };
}

// force defaults equal the d3 defaults so an untouched panel matches today's layout
export function defaultSettings(): Settings {
  return {
    sectionFilter: "both",
    showTags: true,
    showOrphans: true,
    groups: [],
    display: { textFadeThreshold: 10, nodeSize: 1, linkThickness: 1 },
    forces: {
      centerStrength: 1,
      repelStrength: 30,
      linkStrength: 1,
      linkDistance: 30,
    },
  };
}
