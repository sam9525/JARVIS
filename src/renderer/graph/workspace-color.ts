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

/** Below this OKLab distance (×100), two group colours stop being tellable
 * apart on a graph. 11 is red at 0° against orange at 25°, the pair that
 * prompted a minimum. Degrees cannot be the unit: at this saturation and
 * lightness one 10° step moves red by ΔE 4–5 but green by ΔE 2, so 60° of
 * green still reads as one colour. */
export const MIN_DELTA_E = 11;

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

// Every hue outside the reserved bands: the only hues a draw or the fallback
// may return.
const FREE_HUES = Array.from({ length: 360 }, (_, h) => h).filter(
  (h) => !bandOf(h),
);

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

/** The identity hue of one workspace among the fleet: its biggest folder's hue
 * (ties going to the alphabetically first), not the first hue drawn, which
 * `Settings.mainColors` holds. The single entry point for views — Fleet paints
 * a project's whole cluster with it, so it has to be the same number the
 * project's own graph leads with.
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

// OKLab of a #rrggbb colour (Björn Ottosson's matrices), the space where equal
// distances look equally different.
function oklab(hex: string): [number, number, number] {
  const lin = (i: number) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = [lin(1), lin(3), lin(5)];
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675884 * s,
  ];
}

const HUE_LAB = Array.from({ length: 360 }, (_, h) => oklab(hueToHex(h)));

/** How different two hues look as group colours: OKLab distance ×100 at the
 * group saturation and lightness. */
export function colourGap(a: number, b: number): number {
  const [p, q] = [HUE_LAB[wrap(a)], HUE_LAB[wrap(b)]];
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) * 100;
}

/** How many recent picks a new hue has to clear. The free wheel holds only
 * about 8 hues MIN_DELTA_E apart, so a full log of twelve always leaves the
 * random draw blocked and `nextHue` choosing — which keeps a repeat of a
 * colour you just saw impossible, and makes the thirteenth the first that may
 * come back. */
export const RECENT_PICKS = 12;

/** A random hue that is no near-match of anything in `recent`, and outside the
 * reserved bands. `recent` is the tail of the pick log, newest last; only the
 * last RECENT_PICKS entries are honoured, so a colour becomes available again
 * once twelve other picks have gone by.
 *
 * The draw is uniform over the free hues. Drawing over the whole wheel and
 * clamping out of a band would hand every in-band draw to the band's edge.
 * Rejection sampling, then `nextHue` as the floor: the wheel holds fewer clear
 * hues than the log bans, so "keep drawing until one clears" is not
 * guaranteed to terminate — the furthest-hue pick always returns something,
 * and returns the least-bad something.
 *
 * `own` is the hues already on this hue's own graph. The fallback keeps clear
 * of those first, because two groups in one graph sit side by side, while two
 * projects' groups only meet across cards. */
export function pickHue(
  recent: number[],
  own: number[] = [],
  tries = 60,
): number {
  const ban = recent.slice(-RECENT_PICKS);
  for (let i = 0; i < tries; i++) {
    const h = FREE_HUES[Math.floor(Math.random() * FREE_HUES.length)];
    if (ban.every((b) => colourGap(h, b) >= MIN_DELTA_E)) return h;
  }
  return nextHue(
    ban.map((h) => hueToHex(h)),
    0,
    own,
  );
}

/** `count` hues drawn in sequence, each one clearing the twelve before it —
 * including the ones drawn inside this same call, so seeding a workspace's
 * folders in one go cannot hand two of them the same green. */
export function pickHues(count: number, recent: number[] = []): number[] {
  const log = [...recent];
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    const h = pickHue(log, out);
    out.push(h);
    log.push(h);
  }
  return out;
}

/** The free hue that looks least like every colour already in use: the one
 * whose nearest used colour is furthest away in OKLab. The floor under
 * `pickHue` — where every random draw is blocked, this still answers, and
 * answers with the roomiest hue left. Measured in OKLab, not degrees, for the
 * reason MIN_DELTA_E gives; and only free hues are candidates, so nothing is
 * clamped onto a band's edge.
 *
 * Hues in `own` (the same graph's colours) come first: only hues MIN_DELTA_E
 * clear of all of them are candidates, and when none is, the pick is simply
 * the hue furthest from them. */
export function nextHue(
  used: string[],
  fallback = 0,
  own: number[] = [],
): number {
  const hues = used.map(hexToHue).filter((h): h is number => h !== null);
  if (hues.length === 0 && own.length === 0)
    return avoidReserved(wrap(fallback));
  const room = (h: number, from: number[]) =>
    Math.min(Infinity, ...from.map((u) => colourGap(h, u)));
  const clear = FREE_HUES.filter((h) => room(h, own) >= MIN_DELTA_E);
  const candidates = clear.length > 0 ? clear : FREE_HUES;
  const against = clear.length > 0 ? [...hues, ...own] : own;
  let best = candidates[0];
  let roomiest = -1;
  for (const h of candidates) {
    const nearest = room(h, against);
    if (nearest > roomiest) {
      roomiest = nearest;
      best = h;
    }
  }
  return best;
}

/** How different two #rrggbb colours look: OKLab distance ×100 of the colours
 * themselves, lightness and saturation included. Hue alone cannot say: the
 * same hue at another lightness is another colour, and two hexes a digit
 * apart are one. */
export function hexGap(a: string, b: string): number {
  const [p, q] = [oklab(a), oklab(b)];
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) * 100;
}

/** `mains` with every colour that looks like an earlier one — closer than
 * MIN_DELTA_E — redrawn as the free hue furthest from the colours before it,
 * kept off the project's own other group colours (`own`) first. Earlier means
 * earlier in key order, which is seeding order, so the project that drew a
 * colour first keeps it.
 *
 * ponytail: the free wheel holds about 8 hues MIN_DELTA_E apart, so from the
 * ninth project on the redraw settles for the roomiest hue, not a clear one.
 * Spread mains over lightness too if that stops being enough. Deterministic
 * either way, so a pass over its own output changes nothing — which is what
 * lets a settings effect run it on every render without looping. */
export function distinctMains(
  mains: Record<string, string>,
  own: Record<string, string[]> = {},
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [id, hex] of Object.entries(mains)) {
    const before = Object.values(out);
    const ownHues = (own[id] ?? [])
      .filter((c) => c !== hex)
      .map(hexToHue)
      .filter((h): h is number => h !== null);
    out[id] = before.every((b) => hexGap(hex, b) >= MIN_DELTA_E)
      ? hex
      : hueToHex(nextHue(before, 0, ownHues));
  }
  return out;
}
