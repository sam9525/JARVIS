import { promises as fs } from "node:fs";
import { defaultSettings } from "../shared/types";
import { randomColor } from "../shared/random-color";
import type { GraphGroup, Settings, VaultGraph } from "../shared/types";

export async function loadSettings(file: string): Promise<Settings> {
  const s = defaultSettings();
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(file, "utf8"));
    if (typeof parsed !== "object" || parsed === null) return s;
    const p = parsed as Record<string, unknown>;
    if (p.dimensions === "2d" || p.dimensions === "3d") {
      s.dimensions = p.dimensions;
    }
    if (
      p.sectionFilter === "raw" ||
      p.sectionFilter === "wiki" ||
      p.sectionFilter === "both"
    ) {
      s.sectionFilter = p.sectionFilter;
    }
    if (typeof p.showTags === "boolean") s.showTags = p.showTags;
    if (typeof p.showOrphans === "boolean") s.showOrphans = p.showOrphans;
    if (Array.isArray(p.groups)) {
      s.groups = p.groups.filter(
        (g): g is GraphGroup =>
          typeof g === "object" &&
          g !== null &&
          typeof (g as Record<string, unknown>).query === "string" &&
          typeof (g as Record<string, unknown>).color === "string",
      );
    }
    // per-view display/forces (new format). A legacy flat display/forces from
    // an older settings file seeds BOTH modes first, then any per-view values
    // present in the file win.
    const views = asRecord(p.views);
    for (const mode of ["2d", "3d"] as const) {
      mergeFiniteNumbers(s.views[mode].display, p.display);
      mergeFiniteNumbers(s.views[mode].forces, p.forces);
      const v = asRecord(views[mode]);
      mergeFiniteNumbers(s.views[mode].display, v.display);
      mergeFiniteNumbers(s.views[mode].forces, v.forces);
    }
  } catch {
    // missing or unreadable file → defaults; rewritten on next save
  }
  return s;
}

function asRecord(u: unknown): Record<string, unknown> {
  return typeof u === "object" && u !== null
    ? (u as Record<string, unknown>)
    : {};
}

// shallow per-group merge: unknown/bad values keep their defaults
function mergeFiniteNumbers(
  target: Record<string, number>,
  src: unknown,
): void {
  if (typeof src !== "object" || src === null) return;
  const o = src as Record<string, unknown>;
  for (const k of Object.keys(target)) {
    const v = o[k];
    if (typeof v === "number" && Number.isFinite(v)) target[k] = v;
  }
}

export async function saveSettings(file: string, s: Settings): Promise<void> {
  await fs.writeFile(file, JSON.stringify(s, null, 2) + "\n", "utf8");
}

// one group per top-level vault folder; trailing slash keeps the substring
// matcher (groupColor) from hitting folder names embedded mid-path
export function autoGroups(graph: VaultGraph): GraphGroup[] {
  const domains = new Set<string>();
  for (const n of graph.nodes) if (n.domain) domains.add(n.domain);
  return [...domains].map((d) => ({ query: `${d}/`, color: randomColor() }));
}
