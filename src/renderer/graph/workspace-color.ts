import type { GraphGroup, Workspace } from "../../shared/types";
import { fleetDomains } from "./fleet-graph";

// Hue assignment, generated rather than listed. The fixed PALETTE this
// replaces was indexed by a *local* domain list, so every workspace restarted
// at entry 0 and two unrelated projects drew the same green.
//
// Hues are spaced evenly over the count they are drawn from, which is the
// widest any n hues can be spread. Golden angle was the other candidate and
// packs two of its first eight within 20 degrees — the same "which green is
// this" problem, one level down.

/** Hue bands the highlight layer owns: cyan for the read ring, hover and
 * accent (#67e8f9 / #22d3ee / #7ef9ff), amber for `modified` (#f59e0b). A
 * node tinted from either band reads as highlighted when it is not. */
export const RESERVED: readonly (readonly [number, number])[] = [
  [172, 202],
  [10, 40],
];

const SAT = 65;
const LIGHT = 66;

const wrap = (h: number) => ((Math.round(h) % 360) + 360) % 360;

const bandOf = (h: number) => RESERVED.find(([lo, hi]) => h >= lo && h <= hi);

// Out of a reserved band by its *nearer* edge. Leaving by the far edge would
// shove the hue toward its neighbour and undo the even spacing.
function avoidReserved(h: number): number {
  const band = bandOf(h);
  if (!band) return h;
  const [lo, hi] = band;
  return wrap(h - lo <= hi - h ? lo - 1 : hi + 1);
}

/** The `index`-th of `count` hues, starting at `baseHue`. Index 0 is the base
 * hue itself, so a caller's own colour always leads its own spread. */
export function hueFrom(baseHue: number, index: number, count: number): number {
  const step = 360 / Math.max(count, 1);
  return avoidReserved(wrap(baseHue + index * step));
}

/** A workspace's identity hue. Keyed by *name* against the fleet domain list,
 * because that is what Fleet colours its clusters by — index into anything
 * else and a project draws one colour at home and another in Fleet. */
export function workspaceHue(name: string, allNames: string[]): number {
  const sorted = [...allNames].sort();
  const i = sorted.indexOf(name);
  return hueFrom(0, i === -1 ? 0 : i, sorted.length);
}

/** The identity hue of one workspace among the fleet. The single entry point
 * for views — it pairs the name with the right list so no caller has to
 * remember that the fleet root holds a slot of its own. */
export function hueOfWorkspace(ws: Workspace, fleet: Workspace[]): number {
  return workspaceHue(ws.name, fleetDomains(fleet));
}

/** #rrggbb, not `hsl()`: graph-colors' `brighten` only matches six hex digits
 * and passes anything else straight through, which would kill node heat. */
export function hueToHex(hue: number, sat = SAT, light = LIGHT): string {
  const s = sat / 100;
  const l = light / 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const h = wrap(hue) / 60;
  const x = c * (1 - Math.abs((h % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = (
    [
      [c, x, 0],
      [x, c, 0],
      [0, c, x],
      [0, x, c],
      [x, 0, c],
      [c, 0, x],
    ] as const
  )[Math.floor(h) % 6];
  const hex = (v: number) =>
    Math.round((v + m) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

/** Hue of a #rrggbb colour, or null for grey and for anything unparseable —
 * a colour with no hue cannot crowd another on the wheel. */
export function hexToHue(hex: string): number | null {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return null;
  const [r, g, b] = m.slice(1).map((v) => parseInt(v, 16) / 255);
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  if (d === 0) return null;
  const h =
    max === r
      ? ((g - b) / d) % 6
      : max === g
        ? (b - r) / d + 2
        : (r - g) / d + 4;
  return wrap(h * 60);
}

/** The hue furthest from every colour already in use: the middle of the widest
 * gap on the wheel. What the "+ group" button picks, so a hand-added group
 * cannot come out a near-match of one already there — which is exactly how
 * the randomColor() this replaces produced red, dark pink and orange in one
 * vault. Falls back to the workspace hue when nothing is in use yet. */
export function nextHue(used: string[], fallback = 0): number {
  const hues = used
    .map(hexToHue)
    .filter((h): h is number => h !== null)
    .sort((a, b) => a - b);
  if (hues.length === 0) return avoidReserved(wrap(fallback));
  let best = hues[0];
  let widest = -1;
  for (let i = 0; i < hues.length; i++) {
    const from = hues[i];
    const to = i + 1 < hues.length ? hues[i + 1] : hues[0] + 360;
    if (to - from > widest) {
      widest = to - from;
      best = wrap(from + (to - from) / 2);
    }
  }
  return avoidReserved(best);
}

/** Below this many degrees apart, two group colours stop being tellable apart
 * on a graph — red at 0 and orange at 25 is the pair that prompted this. */
export const MIN_APART = 25;

const wheelGap = (a: number, b: number) => {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
};

function anyTooClose(groups: GraphGroup[]): boolean {
  const hues = groups
    .map((g) => hexToHue(g.color))
    .filter((h): h is number => h !== null);
  for (let i = 0; i < hues.length; i++)
    for (let j = i + 1; j < hues.length; j++)
      if (wheelGap(hues[i], hues[j]) < MIN_APART) return true;
  return false;
}

/** Re-spaces the colours of groups saved before hues were generated, when two
 * of them sit too close to tell apart. Queries are untouched — only colours
 * move. Returns null when there is nothing to fix or the fix would change
 * nothing, which is what stops the caller writing settings in a loop: a second
 * pass over an already-spaced list recomputes the same colours and backs off. */
export function respaceGroups(
  groups: GraphGroup[],
  baseHue: number,
): GraphGroup[] | null {
  if (groups.length < 2 || !anyTooClose(groups)) return null;
  const next = groups.map((g, i) => ({
    ...g,
    color: hueToHex(hueFrom(baseHue, i, groups.length)),
  }));
  return next.some((g, i) => g.color !== groups[i].color) ? next : null;
}
