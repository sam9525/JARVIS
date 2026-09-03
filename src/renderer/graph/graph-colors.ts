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

/**
 * Blast radius. A TypeScript constant rather than a CSS token: nothing in
 * this file or workspace-color.ts reads a CSS variable, so the graph could
 * not see one. Violet ~270°, which clears both reserved hue bands — cyan
 * 172-202 (read ring, hover, accent) and amber 10-40 (modified).
 */
export const RADIUS_COLOR = "#c084fc";

// how far each tier blends back toward the node's own colour: depth 0, 1, 2+
const RADIUS_MIX = [0, 0.3, 0.6];

const rgb = (hex: string): [number, number, number] | null => {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return null;
  const v = parseInt(m[1], 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
};

/**
 * The radius tier for one node: full violet at the target, blending toward
 * that node's own colour each hop out, so the radius reads as distance rather
 * than as three unrelated colours. Always #rrggbb — brighten only matches six
 * hex digits, so an hsl() here would silently stop heat working.
 */
export function radiusColor(depth: number, base: string): string {
  const t = RADIUS_MIX[Math.min(Math.max(depth, 0), RADIUS_MIX.length - 1)];
  if (t <= 0) return RADIUS_COLOR;
  const a = rgb(RADIUS_COLOR);
  const b = rgb(base);
  if (!a || !b) return RADIUS_COLOR; // an unparseable base leaves the violet flat
  const mix = (i: number) => Math.round(a[i] + (b[i] - a[i]) * t);
  const out = (mix(0) << 16) | (mix(1) << 8) | mix(2);
  return `#${out.toString(16).padStart(6, "0")}`;
}
