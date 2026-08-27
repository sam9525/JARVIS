import type { GraphGroup, VaultGraph } from "../../shared/types";
import { COLORS } from "./graph-colors";
import { hueFrom, hueToHex } from "./workspace-color";

const FALLBACK = "#4a5568"; // pre-domain note grey

export function domainsOf(g: VaultGraph): string[] {
  const s = new Set<string>();
  for (const n of g.nodes) if (n.domain) s.add(n.domain);
  return Array.from(s).sort();
}

/** `baseHue` is the workspace's identity hue, so a project's first domain is
 * its own colour and the rest fan out from there. Fleet leaves it at 0 and
 * passes every workspace name as a domain, which reproduces the identity hue
 * for each cluster without knowing that is what it is doing. */
export function colorFor(
  domain: string | undefined,
  domains: string[],
  baseHue = 0,
): string {
  if (!domain) return FALLBACK;
  const i = domains.indexOf(domain);
  if (i === -1) return FALLBACK;
  return hueToHex(hueFrom(baseHue, i, domains.length));
}

// first group whose non-empty query is a case-insensitive substring of the id
export function groupOf(
  id: string,
  groups: GraphGroup[],
): GraphGroup | undefined {
  const lower = id.toLowerCase();
  for (const g of groups) {
    const q = g.query.trim().toLowerCase();
    if (q !== "" && lower.includes(q)) return g;
  }
  return undefined;
}

export function groupColor(
  id: string,
  groups: GraphGroup[],
): string | undefined {
  return groupOf(id, groups)?.color;
}

// node color minus highlight state — group wins, then tag, then domain.
// Links derive endpoint colors from this so read flares don't recolor edges.
export function baseNodeColor(
  node: { id: string; type?: string; domain?: string },
  domains: string[],
  groups: GraphGroup[],
  baseHue = 0,
): string {
  const g = groupOf(node.id, groups);
  if (g) return g.color;
  return node.type === "tag"
    ? COLORS.tag
    : colorFor(node.domain, domains, baseHue);
}
