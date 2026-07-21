// Shared by Graph (2D canvas) and Graph3D (WebGL). "modified" matches the
// NodeDisplay value from highlight-store; "ring" is the read-highlight ring,
// "trail" is the read-order arrows between consecutively read nodes.
// "match" is the transient glow on files a Grep/Glob actually matched.
export const COLORS = {
  bg: "#02060b",
  tag: "#1d4356",
  link: "#12283a",
  label: "#7fa3b5",
  hover: "#22d3ee",
  ring: "#67e8f9",
  modified: "#f59e0b",
  trail: "#ff8fab",
  match: "#a78bfa", // files a search hit — transient, distinct from the read ring
} as const;
