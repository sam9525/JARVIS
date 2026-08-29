import { promises as fs } from "node:fs";
import { defaultSettings } from "../shared/types";
import type {
  GraphGroup,
  PanelId,
  PanelMap,
  PanelState,
  Settings,
} from "../shared/types";

export async function loadSettings(file: string): Promise<Settings> {
  const s = defaultSettings();
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(file, "utf8"));
    if (typeof parsed !== "object" || parsed === null) return s;
    const p = parsed as Record<string, unknown>;
    if (p.dimensions === "2d" || p.dimensions === "3d") {
      s.dimensions = p.dimensions;
    }
    if (p.codeGraphLevel === "file" || p.codeGraphLevel === "symbol") {
      s.codeGraphLevel = p.codeGraphLevel;
    }
    if (
      p.sectionFilter === "raw" ||
      p.sectionFilter === "wiki" ||
      p.sectionFilter === "both"
    ) {
      s.sectionFilter = p.sectionFilter;
    }
    // absent stays absent for both: the renderer treats "no entry" as "never
    // drawn" and draws one, where a 0 or an [] would read as a real value
    const main = asRecord(p.mainColors);
    for (const [id, hex] of Object.entries(main)) {
      if (typeof hex === "string" && /^#[0-9a-f]{6}$/i.test(hex))
        (s.mainColors ??= {})[id] = hex;
    }
    if (Array.isArray(p.recentHues)) {
      const hues = p.recentHues.filter(
        (h): h is number => typeof h === "number" && Number.isFinite(h),
      );
      // only the last RECENT_PICKS (10) are ever honoured; trimming on the way
      // in stops a corrupted file being loaded and written back at full length
      if (hues.length > 0) s.recentHues = hues.slice(-10);
    }
    if (typeof p.showTags === "boolean") s.showTags = p.showTags;
    if (typeof p.showOrphans === "boolean") s.showOrphans = p.showOrphans;
    if (typeof p.handControl === "boolean") s.handControl = p.handControl;
    if (typeof p.voiceControl === "boolean") s.voiceControl = p.voiceControl;
    if (typeof p.micDeviceId === "string" && p.micDeviceId)
      s.micDeviceId = p.micDeviceId;
    for (const k of ["ttsVoiceId", "ttsModelId", "headModel"] as const) {
      if (typeof p[k] === "string" && p[k]) s[k] = p[k] as string;
    }
    // groups are keyed by workspace id; a legacy flat array is dropped (the
    // renderer re-seeds each workspace from its own graph on first open)
    if (typeof p.groups === "object" && p.groups !== null) {
      for (const [id, list] of Object.entries(p.groups)) {
        if (Array.isArray(list)) s.groups[id] = list.filter(isGroup);
      }
    }
    // panel geometry, per layout. A malformed entry is dropped rather than
    // repaired: the renderer falls back to defaultPanel() for any absent key,
    // which is always a sane position (design §6).
    const panels = asRecord(p.panels);
    for (const layout of ["home", "workspace"] as const) {
      s.panels[layout] = readPanelMap(panels[layout]);
    }
    // the window those panels were measured in; absent → the renderer takes
    // the current one and rescales nothing
    const vp = asRecord(p.panelViewport);
    if (isSize(vp.width) && isSize(vp.height))
      s.panelViewport = { width: vp.width, height: vp.height };
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

function isSize(u: unknown): u is number {
  return typeof u === "number" && Number.isFinite(u) && u > 0;
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

function isGroup(g: unknown): g is GraphGroup {
  return (
    typeof g === "object" &&
    g !== null &&
    typeof (g as Record<string, unknown>).query === "string" &&
    typeof (g as Record<string, unknown>).color === "string"
  );
}

export async function saveSettings(file: string, s: Settings): Promise<void> {
  await fs.writeFile(file, JSON.stringify(s, null, 2) + "\n", "utf8");
}

const PANEL_IDS: readonly PanelId[] = ["terminal", "preview", "settings"];

function readPanelMap(u: unknown): PanelMap {
  const src = asRecord(u);
  const out: PanelMap = {};
  for (const id of PANEL_IDS) {
    const p = src[id];
    if (isPanelState(p)) out[id] = p;
  }
  return out;
}

function isPanelState(u: unknown): u is PanelState {
  if (typeof u !== "object" || u === null) return false;
  const o = u as Record<string, unknown>;
  const num = (k: string) =>
    typeof o[k] === "number" && Number.isFinite(o[k] as number);
  return (
    num("x") &&
    num("y") &&
    num("w") &&
    num("h") &&
    num("z") &&
    typeof o.collapsed === "boolean"
  );
}
