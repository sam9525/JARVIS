// Obsidian-style shortest-link resolution: exact path → case-insensitive
// path → basename. Shared by the vault scanner (edges) and the preview
// renderer (clickable wikilinks) so both resolve links identically.
export function resolveWikilink(
  target: string,
  byPath: Set<string>,
  byBasename: Map<string, string>,
  byPathLower: Map<string, string>,
): string | null {
  const clean = target.replace(/\.md$/i, "");
  if (byPath.has(clean)) return clean;

  const cleanLower = clean.toLowerCase();
  const caseInsensitivePath = byPathLower.get(cleanLower);
  if (caseInsensitivePath) return caseInsensitivePath;

  const parts = cleanLower.split("/");
  const base = parts[parts.length - 1] || "";
  return byBasename.get(base) ?? null;
}

export function buildWikilinkResolver(
  noteIds: string[],
): (target: string) => string | null {
  const byPath = new Set(noteIds);
  const byPathLower = new Map<string, string>();
  // ponytail: ambiguous basenames resolve to first found; good enough for v1
  const byBasename = new Map<string, string>();
  for (const id of noteIds) {
    byPathLower.set(id.toLowerCase(), id);
    const parts = id.split("/");
    const base = (parts[parts.length - 1] || "").toLowerCase();
    if (!byBasename.has(base)) byBasename.set(base, id);
  }
  return (target) => resolveWikilink(target, byPath, byBasename, byPathLower);
}
