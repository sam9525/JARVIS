import type { Workspace } from "../../shared/types";
import { fleetDomains } from "./fleet-graph";

// Hue assignment, drawn rather than listed. Two schemes live here and they
// answer different questions.
//
// pickHue draws at random against a log of the last RECENT_PICKS hues. It is
// what groups and workspaces actually get, and the randomness is the point:
// every deterministic scheme this replaces — a fixed PALETTE, then an evenly
// spaced spread — made the palette a pure function of the names, so a project
// drew the same colour on every machine and deleting the settings file handed
// the identical colours straight back.
//
// hueFrom spaces n hues evenly, which is the widest any n can be spread. It
// survives as the fallback for anything not yet drawn, and as the floor under
// pickHue when the ban list leaves no room to draw.

/** Hue bands the highlight layer owns: cyan for the read ring, hover and
 * accent (#67e8f9 / #22d3ee / #7ef9ff), amber for `modified` (#f59e0b). A
 * node tinted from either band reads as highlighted when it is not. */
export const RESERVED: readonly (readonly [number, number])[] = [
  [172, 202],
  [10, 40],
];

/** Below this many degrees apart, two group colours stop being tellable apart
 * on a graph — red at 0 and orange at 25 is the pair that prompted this. */
export const MIN_APART = 25;

const wheelGap = (a: number, b: number) => {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
};

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

// Degrees the reserved bands take, and what is left to spread over. Spacing
// over the free wheel is what keeps two indices off one band edge: the clamp
// maps a whole band onto a single degree, and two neighbours that both land
// in it come out the same colour.
const RESERVED_SPAN = RESERVED.reduce((n, [lo, hi]) => n + (hi - lo + 1), 0);
const FREE = 360 - RESERVED_SPAN;

// `offset` degrees around the wheel from `baseHue`, counting free degrees
// only — a reserved band is stepped over rather than counted.
function freeHue(baseHue: number, offset: number): number {
  let h = avoidReserved(wrap(baseHue));
  for (let i = 0; i < offset; i++) {
    h = wrap(h + 1);
    const band = bandOf(h);
    if (band) h = wrap(band[1] + 1);
  }
  return h;
}

/** The `index`-th of `count` hues, starting at `baseHue`. Index 0 is the base
 * hue itself, so a caller's own colour always leads its own spread.
 *
 * ponytail: distinct up to FREE (298) domains, because below one free degree
 * per index two of them share one. Spread over a second dimension —
 * lightness — if a workspace ever carries more folders than that. */
export function hueFrom(baseHue: number, index: number, count: number): number {
  const step = FREE / Math.max(count, 1);
  return freeHue(baseHue, Math.floor(index * step));
}

/** A workspace's identity hue when nothing has been picked for it yet. Keyed by
 * *name* against the fleet domain list, because that is what Fleet colours its
 * clusters by — index into anything else and a project draws one colour at home
 * and another in Fleet. Deterministic, so two machines agree before either has
 * seeded anything. */
export function workspaceHue(name: string, allNames: string[]): number {
  const sorted = [...allNames].sort();
  const i = sorted.indexOf(name);
  return hueFrom(0, i === -1 ? 0 : i, sorted.length);
}

/** The identity hue of one workspace among the fleet: the first hue its groups
 * ever drew, which `Settings.mainColors` holds. The single entry point for
 * views — Fleet paints a project's whole cluster with it, so it has to be the
 * same number the project's own graph leads with.
 *
 * The deterministic spread is the fallback, not the rule: it covers a workspace
 * whose graph has not loaded yet, which would otherwise flash grey and then
 * jump colour the moment its folders seeded. */
export function hueOfWorkspace(
  ws: Workspace,
  fleet: Workspace[],
  mainColors: Record<string, string> = {},
): number {
  const picked = hexToHue(mainColors[ws.id] ?? "");
  return picked ?? workspaceHue(ws.name, fleetDomains(fleet));
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

/** How many recent picks a new hue has to clear. Ten is the window the whole
 * scheme rests on: the wheel only holds about `360 / MIN_APART` ≈ 14 tellable
 * hues, so banning the last ten leaves a real choice while making a repeat of
 * a colour you just saw impossible. */
export const RECENT_PICKS = 10;

/** A random hue that is no near-match of anything in `recent`, and outside the
 * reserved bands. `recent` is the tail of the pick log, newest last; only the
 * last RECENT_PICKS entries are honoured, so a colour becomes available again
 * once ten other picks have gone by.
 *
 * Rejection sampling, then `nextHue` as the floor. Ten banned hues can cover
 * the whole wheel (10 × 2 × MIN_APART = 500° > 360°), so "keep drawing until
 * one clears" is not guaranteed to terminate — the widest-gap pick always
 * returns something, and returns the least-bad something. */
export function pickHue(recent: number[], tries = 60): number {
  const ban = recent.slice(-RECENT_PICKS);
  for (let i = 0; i < tries; i++) {
    const h = avoidReserved(wrap(Math.random() * 360));
    if (ban.every((b) => wheelGap(h, b) >= MIN_APART)) return h;
  }
  return nextHue(ban.map((h) => hueToHex(h)));
}

/** `count` hues drawn in sequence, each one clearing the ten before it —
 * including the ones drawn inside this same call, so seeding a workspace's
 * folders in one go cannot hand two of them the same green. */
export function pickHues(count: number, recent: number[] = []): number[] {
  const log = [...recent];
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    const h = pickHue(log);
    out.push(h);
    log.push(h);
  }
  return out;
}

/** The hue furthest from every colour already in use: the middle of the widest
 * gap on the wheel. The floor under `pickHue` — where every random draw is
 * blocked, this still answers, and answers with the roomiest hue left. */
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
