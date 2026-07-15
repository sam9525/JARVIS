// Shared by Graph (2D canvas) and Graph3D (WebGL). "modified" matches the
// NodeDisplay value from highlight-store; "ring" is the read-highlight ring
// and the read-order arrow color.
export const COLORS = {
  bg: "#02060b",
  tag: "#1d4356",
  link: "#12283a",
  label: "#7fa3b5",
  hover: "#22d3ee",
  ring: "#67e8f9",
  modified: "#f59e0b",
} as const;
