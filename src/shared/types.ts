export type ToolName =
  "Read" | "Grep" | "Glob" | "Edit" | "Write" | "Prompt" | "Impact";

export interface ToolEvent {
  sessionId: string;
  workspaceId: string; // which workspace's graph/highlights this event drives
  phase: "pre" | "post";
  tool: ToolName;
  // vault: relative POSIX path without .md; code: relative POSIX path with
  // extension. v1 emits 0 or 1 entries; stays an array for multi-file matches.
  nodeIds: string[];
  pattern?: string; // Grep/Glob only
  /**
   * Impact only: hop count per entry of nodeIds, same length and same order.
   * A parallel array rather than an array of objects, because nodeIds is
   * consumed by countTool and by replay and changing its element type would
   * touch both for no gain.
   */
  depths?: number[];
  ts: number;
}

export type StatusKind =
  | "working" // a turn is in progress
  | "asking" // AskUserQuestion is open — pick an option
  | "blocked" // a permission prompt is open — allow or deny
  | "idle" // at the prompt, nothing pending
  | "crashed" // the PTY exited non-zero
  | "none"; // no session

// what the rail badge and the mission-control cards read
export interface WorkspaceStatus {
  workspaceId: string;
  kind: StatusKind;
  call: string; // compact "Tool(subject)"; "" when there is nothing to show
  message?: string; // idle: the last thing Claude said, for the inbox
  messageAt?: number; // ms epoch of the Stop that set message — tells a repeated reply from the same reply pushed again
  delegatedBy?: string; // orchestrator that submitted the current turn; "" when the user did
  live?: boolean; // this app's own pty is attached right now — not a hand-run CLI
  since: number; // ms epoch of the last kind change — drives "40s ago"
  reads: number; // distinct files read this session
  edits: number; // distinct files edited this session
}

// emitted by the status mapper; "none" is never a hook outcome, only a PTY one
export interface StatusEvent {
  workspaceId: string;
  sessionId: string;
  // "none" is never a hook outcome, only a PTY one; "crashed" likewise
  kind: "working" | "asking" | "blocked" | "idle";
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

/** A previewed file's uncommitted changes against HEAD, as 1-based line
 * numbers in the working copy. `added` lines are new, `modified` lines replace
 * an old line. `removedAfter` holds the line just above each deletion, so 0
 * means lines were removed from the top of the file. */
export interface LineChanges {
  added: number[];
  modified: number[];
  removedAfter: number[];
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

export type PanelId =
  | "terminal"
  | "preview"
  | "settings"
  | "mouth"
  | "ask"
  | "todos"
  | "compose"
  | "view";
export type LayoutId = "home" | "workspace";

/**
 * A mouth marked on a head model: a centre and three half-extents in the
 * model's own normalised space (two units tall, centred), so it means the same
 * thing in any file at any scale or triangle count.
 *
 * A box, not a sphere. A mouth is wider than it is tall and its corners sit
 * still, which a radius cannot say — a sphere pushed the corners out with the
 * centre and the face bulged instead of opening.
 */
export type MouthRegion = {
  c: [number, number, number];
  /** Half-width, across the face. */
  w: number;
  /** Half-height. The mouth opens by a share of this. */
  h: number;
  /** Half-depth, so the region stops short of the back of the head. */
  d: number;
};

/**
 * Geometry only — never openness. Which panels are open lives in App state
 * (`previewNode !== null`, `showSettings`, terminal always present), so an
 * absent key here means "never moved", not "closed".
 */
export interface PanelState {
  x: number;
  y: number;
  w: number;
  h: number;
  collapsed: boolean;
  z: number;
}

export type PanelMap = Partial<Record<PanelId, PanelState>>;

/** One task line of TODO.md. `line` is its 0-based index in the file and
 *  `raw` its exact text: together they are how a panel op proves the line has
 *  not changed since the panel last saw it. */
export interface Todo {
  line: number;
  raw: string;
  done: boolean;
  text: string;
  project: string | null;
  created: string | null;
}

export interface TodoList {
  todos: Todo[];
  /** Lines that start like a task but do not parse — reported to the agent. */
  malformed: { line: number; raw: string }[];
}

export type TodoOp =
  | { kind: "toggle"; line: number; raw: string }
  | {
      kind: "edit";
      line: number;
      raw: string;
      text: string;
      project: string | null;
    }
  | { kind: "delete"; line: number; raw: string }
  | { kind: "add"; text: string; project: string | null }
  | { kind: "move"; line: number; raw: string; toLine: number; toRaw: string };

export type TodoOpResult = { ok: true } | { ok: false; error: string };

/** A `@project` token cannot hold a space, and workspace names can. */
export const projectKey = (name: string): string =>
  name.trim().replace(/\s+/g, "-");

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
  voiceControl: boolean; // the mic listens for "jarvis"; auto-starts when on
  /** Which audio input the tracker opens. Absent = whatever the OS calls
   * default. A saved id that is not plugged in right now is not passed to
   * getUserMedia — an unplugged device reads as Default, never as an error. */
  micDeviceId?: string;
  ttsVoiceId?: string;
  ttsModelId?: string;
  /** An uploaded head model's file name. Absent = the built-in helmet. */
  headModel?: string;
  /** Render the head as the model's own materials instead of edges. */
  headColor?: boolean;
  /** Move the head's mouth with the voice, when the model has one. */
  headMouth?: boolean;
  /**
   * A mouth marked by hand, keyed by model name (`"__builtin"` for the shipped
   * helmet). Outranks a detected region and a real rig alike: picking one costs
   * opening a panel and clicking a face, so it is never accidental.
   */
  headMouths?: Record<string, MouthRegion>;
  panels: Record<LayoutId, PanelMap>; // home and workspace arrange separately
  /**
   * The window `panels` was measured in. Panel geometry is pixels, so without
   * the size it was written at, a layout reopened in a different window can
   * only be clamped — which silently changes every width. Stored as a pair with
   * `panels`, so a reopen rescales once from here and a reopen at the same size
   * is exactly a no-op. Absent on a settings file written before this existed.
   */
  panelViewport?: { width: number; height: number };
  /**
   * A workspace's main colour, keyed by workspace id: its biggest folder's hue
   * (ties going to the alphabetically first). Fleet paints the project's whole
   * cluster with it, so it has to outlive the session that drew it or a project
   * would change colour in Fleet on every launch. Absent until that workspace
   * has seeded its groups.
   */
  mainColors?: Record<string, string>;
  /**
   * The tail of the colour-pick log, newest last, in degrees. A new hue has to
   * clear the last `RECENT_PICKS` of these, so no two colours drawn close
   * together are near-matches. Persisted because the ban list is the only thing
   * standing between a restart and drawing the green you just used.
   */
  recentHues?: number[];
}

// a workspace's groups, or NO_GROUPS if it has never been seeded — a fresh []
// per call would be the same identity-change refresh storm NO_GROUPS exists
// to avoid (v0.3.5 §5).
export function groupsFor(
  settings: Settings,
  id: string | null | undefined,
): GraphGroup[] {
  return (id && settings.groups[id]) || NO_GROUPS;
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
    voiceControl: false,
    ttsModelId: "eleven_multilingual_v2",
    panels: { home: {}, workspace: {} },
  };
}
