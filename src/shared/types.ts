export type ToolName = "Read" | "Grep" | "Glob" | "Edit" | "Write" | "Prompt";

export interface ToolEvent {
  sessionId: string;
  workspaceId: string; // which workspace's graph/highlights this event drives
  phase: "pre" | "post";
  tool: ToolName;
  // vault: relative POSIX path without .md; code: relative POSIX path with
  // extension. v1 emits 0 or 1 entries; stays an array for multi-file matches.
  nodeIds: string[];
  pattern?: string; // Grep/Glob only
  ts: number;
}

export type StatusKind = "waiting" | "running" | "idle" | "none";

// what the rail badge and the mission-control cards read
export interface WorkspaceStatus {
  workspaceId: string;
  kind: StatusKind;
  call: string; // compact "Tool(subject)"; "" when there is nothing to show
  message?: string; // idle: the last thing Claude said, for the inbox
  delegatedBy?: string; // orchestrator that submitted the current turn; "" when the user did
  since: number; // ms epoch of the last kind change — drives "40s ago"
  reads: number; // distinct files read this session
  edits: number; // distinct files edited this session
}

// emitted by the status mapper; "none" is never a hook outcome, only a PTY one
export interface StatusEvent {
  workspaceId: string;
  sessionId: string;
  kind: "waiting" | "running" | "idle";
  call: string;
  message?: string; // Stop only: the last thing Claude said, for the inbox
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
  file?: string; // symbol nodes only: the file this symbol lives in
}

export interface GraphEdge {
  source: string;
  target: string;
}

export interface VaultGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export type WorkspaceKind = "vault" | "code";

export const SOURCE_LABELS: Record<string, string> = {
  vault: "Vault",
  gitnexus: "GitNexus",
  graphify: "Graphify",
  unknown: "Unknown",
};

export interface Workspace {
  id: string; // normalized absolute root path (lowercased, POSIX separators)
  name: string;
  rootPath: string;
  kind: WorkspaceKind;
  sourceId: string;
  isSelf?: boolean;
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

// THE empty groups value. A fresh [] per render is an identity change that
// makes Graph3D refresh() — rebuild sprites for — every node in the scene
// (v0.3.5 §5). Deliberately not readonly/frozen: every consumer types
// GraphGroup[], nothing mutates a groups array, and the casts would cost
// more than the immutability buys.
export const NO_GROUPS: GraphGroup[] = [];

export type Dimensions = "2d" | "3d";
export type CodeGraphLevel = "file" | "symbol";
export type HomeView = "cards" | "ring" | "fleet";

export interface DisplaySettings {
  textFadeThreshold: number; // hide labels drawn smaller than this (screen px)
  nodeSize: number; // multiplier on degree-based radius
  linkThickness: number; // multiplier on link width
  // 3d-only knobs; present on both views so merge/reset stay uniform
  nodeOpacity: number; // glow sprite opacity behind each node
  linkOpacity: number; // link line opacity
  haloPad: number; // group halo radius multiplier past the farthest member
  haloBase: number; // group halo base radius added after padding
  haloOpacity: number; // group halo sprite opacity
  // zoom applied when a note opens: 2d = zoom factor, 3d = camera distance
  focusZoom: number;
}

export interface ForceSettings {
  centerStrength: number;
  repelStrength: number; // applied as charge strength -repelStrength
  linkStrength: number; // multiplier on d3's per-link default
  linkDistance: number;
}

// display + forces are tuned per view (2d/3d) since the same values lay out
// differently in each; filters and dimension stay shared.
export interface ViewSettings {
  display: DisplaySettings;
  forces: ForceSettings;
}

export interface Settings {
  dimensions: Dimensions; // 2d canvas vs 3d WebGL graph
  codeGraphLevel: CodeGraphLevel; // code workspaces: File graph vs symbol graph
  sectionFilter: SectionFilter;
  showTags: boolean;
  showOrphans: boolean;
  groups: Record<string, GraphGroup[]>; // per workspace id; first match wins
  views: Record<Dimensions, ViewSettings>;
  handControl: boolean; // hands drive navigation; the webcam auto-starts when on
}

// a workspace's groups, or none if it has never been seeded
export function groupsFor(
  settings: Settings,
  id: string | null | undefined,
): GraphGroup[] {
  return (id && settings.groups[id]) || [];
}

// force defaults equal the d3 defaults in 2d; 3d values are the hand-tuned
// layout (docs/superpowers/specs/2026-07-10-3d-graph-polish-design.md)
function defaultView(mode: Dimensions): ViewSettings {
  return mode === "2d"
    ? {
        display: {
          textFadeThreshold: 15,
          nodeSize: 1,
          linkThickness: 1,
          nodeOpacity: 0.5,
          linkOpacity: 0.25,
          haloPad: 1.1,
          haloBase: 10,
          haloOpacity: 0.55,
          focusZoom: 6.8,
        },
        forces: {
          centerStrength: 0.5,
          repelStrength: 10,
          linkStrength: 1,
          linkDistance: 50,
        },
      }
    : {
        display: {
          textFadeThreshold: 15,
          nodeSize: 0.5,
          linkThickness: 0.5,
          nodeOpacity: 0.5,
          linkOpacity: 0.25,
          haloPad: 1.1,
          haloBase: 10,
          haloOpacity: 0.55,
          focusZoom: 180,
        },
        forces: {
          centerStrength: 0.5,
          repelStrength: 20,
          linkStrength: 1,
          linkDistance: 60,
        },
      };
}

export function defaultSettings(): Settings {
  return {
    dimensions: "3d",
    codeGraphLevel: "file",
    sectionFilter: "wiki",
    showTags: true,
    showOrphans: true,
    groups: {},
    views: { "2d": defaultView("2d"), "3d": defaultView("3d") },
    handControl: false,
  };
}
