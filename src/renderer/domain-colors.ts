import type { GraphGroup, VaultGraph } from "../shared/types";
import { COLORS } from "./graph-colors";

// categorical hues that read on the #0d1017 background and stay distinct
// from the highlight colors (cyan #7ef9ff, orange #ff8c42)
export const PALETTE = [
  "#e06c75",
  "#61afef",
  "#98c379",
  "#e5c07b",
  "#c678dd",
  "#56b6c2",
  "#ff8fab",
  "#d19a66",
  "#7f9cf5",
  "#4fd1c5",
];

const FALLBACK = "#4a5568"; // pre-domain note grey

export function domainsOf(g: VaultGraph): string[] {
  const s = new Set<string>();
  for (const n of g.nodes) if (n.domain) s.add(n.domain);
  return Array.from(s).sort();
}

export function colorFor(
  domain: string | undefined,
  domains: string[],
): string {
  if (!domain) return FALLBACK;
  const i = domains.indexOf(domain);
  return i === -1 ? FALLBACK : PALETTE[i % PALETTE.length];
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
): string {
  const g = groupOf(node.id, groups);
  if (g) return g.color;
  return node.type === "tag" ? COLORS.tag : colorFor(node.domain, domains);
}
