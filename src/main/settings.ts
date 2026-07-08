import { promises as fs } from "node:fs";
import { defaultSettings } from "../shared/types";
import type { Settings } from "../shared/types";

export async function loadSettings(file: string): Promise<Settings> {
  const s = defaultSettings();
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(file, "utf8"));
    if (typeof parsed !== "object" || parsed === null) return s;
    const p = parsed as Record<string, unknown>;
    if (
      p.sectionFilter === "raw" ||
      p.sectionFilter === "wiki" ||
      p.sectionFilter === "both"
    ) {
      s.sectionFilter = p.sectionFilter;
    }
    if (typeof p.domainColors === "object" && p.domainColors !== null) {
      const colors = p.domainColors as Record<string, unknown>;
      for (const key of Object.keys(colors)) {
        const v = colors[key];
        if (typeof v === "string") s.domainColors[key] = v;
      }
    }
  } catch {
    // missing or unreadable file → defaults; rewritten on next save
  }
  return s;
}

export async function saveSettings(file: string, s: Settings): Promise<void> {
  await fs.writeFile(file, JSON.stringify(s, null, 2) + "\n", "utf8");
}
