// Shared by Graph (2D canvas) and Graph3D (WebGL). Keys "read-bright" /
// "read-dim" / "modified" match NodeDisplay values from highlight-store.
export const COLORS = {
  bg: "#0d1017",
  tag: "#2f3a4d",
  link: "#232a38",
  label: "#8b93a7",
  hover: "#7ef9ff",
  "read-bright": "#7ef9ff",
  "read-dim": "#2b6a70",
  modified: "#ff8c42",
} as const;
