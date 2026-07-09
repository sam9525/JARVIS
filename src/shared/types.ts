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

export type Dimensions = "2d" | "3d";

export interface DisplaySettings {
  textFadeThreshold: number; // hide labels drawn smaller than this (screen px)
  nodeSize: number; // multiplier on degree-based radius
  linkThickness: number; // multiplier on link width
}

export interface ForceSettings {
  centerStrength: number;
  repelStrength: number; // applied as charge strength -repelStrength
  linkStrength: number; // multiplier on d3's per-link default
  linkDistance: number;
}

// display + forces are tuned per view (2d/3d) since the same values lay out
// differently in each; filters, groups, and dimension stay shared.
export interface ViewSettings {
  display: DisplaySettings;
  forces: ForceSettings;
}

export interface Settings {
  dimensions: Dimensions; // 2d canvas vs 3d WebGL graph
  sectionFilter: SectionFilter;
  showTags: boolean;
  showOrphans: boolean;
  groups: GraphGroup[]; // first matching group wins
  views: Record<Dimensions, ViewSettings>;
}

// force defaults equal the d3 defaults so an untouched panel matches today's layout
function defaultView(): ViewSettings {
  return {
    display: { textFadeThreshold: 15, nodeSize: 1, linkThickness: 1 },
    forces: {
      centerStrength: 0.5,
      repelStrength: 10,
      linkStrength: 1,
      linkDistance: 50,
    },
  };
}

export function defaultSettings(): Settings {
  return {
    dimensions: "2d",
    sectionFilter: "wiki",
    showTags: true,
    showOrphans: true,
    groups: [],
    views: { "2d": defaultView(), "3d": defaultView() },
  };
}
