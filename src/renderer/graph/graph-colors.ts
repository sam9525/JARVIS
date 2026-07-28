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

const HEAT_MIX = 0.55; // how far toward white a fully hot node goes

// Heat's colour channel. Sits on top of whichever colour already won (domain,
// group, or `modified`), so it overwrites no existing meaning — it is an
// intensity ramp on them. Non-#rrggbb input passes through untouched.
export function brighten(hex: string, t: number): string {
  if (t <= 0) return hex;
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const v = parseInt(m[1], 16);
  const mix = Math.min(t, 1) * HEAT_MIX;
  const up = (c: number) => Math.round(c + (255 - c) * mix);
  const rgb =
    (up((v >> 16) & 255) << 16) | (up((v >> 8) & 255) << 8) | up(v & 255);
  return `#${rgb.toString(16).padStart(6, "0")}`;
}
