import type { VaultGraph } from "../shared/types";

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
  custom: Record<string, string>,
): string {
  if (!domain) return FALLBACK;
  const customColor = custom[domain];
  if (customColor) return customColor;
  const i = domains.indexOf(domain);
  return i === -1 ? FALLBACK : PALETTE[i % PALETTE.length];
}
