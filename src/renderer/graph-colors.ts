// Shared by Graph (2D canvas) and Graph3D (WebGL). "modified" matches the
// NodeDisplay value from highlight-store; "ring" is the read-highlight ring
// and the read-order arrow color.
export const COLORS = {
  bg: "#0d1017",
  tag: "#2f3a4d",
  link: "#232a38",
  label: "#8b93a7",
  hover: "#7ef9ff",
  ring: "#ff8fab",
  modified: "#ff8c42",
} as const;
