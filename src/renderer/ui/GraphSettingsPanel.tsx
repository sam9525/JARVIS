import React from "react";
import { defaultSettings } from "../../shared/types";
import type {
  DisplaySettings,
  ForceSettings,
  GraphGroup,
  SectionFilter,
  Settings,
  ViewSettings,
} from "../../shared/types";
import { randomColor } from "../../shared/random-color";
import Segmented from "./Segmented";

const SECTION_OPTIONS: { value: SectionFilter; label: string }[] = [
  { value: "raw", label: "Raw" },
  { value: "wiki", label: "Wiki" },
  { value: "both", label: "Both" },
];

type SliderSpec<K> = {
  key: K;
  label: string;
  min: number;
  max: number;
  step: number;
};

type DisplaySlider = SliderSpec<keyof DisplaySettings>;

// prettier-ignore
const BASE_DISPLAY: DisplaySlider[] = [
  { key: "textFadeThreshold", label: "Text fade threshold", min: 2, max: 30, step: 1 },
  { key: "nodeSize", label: "Node size", min: 0.5, max: 3, step: 0.1 },
  { key: "linkThickness", label: "Link thickness", min: 0.5, max: 4, step: 0.1 },
];

// same setting, different meaning per view: 2d zooms, 3d flies the camera in
// prettier-ignore
const FOCUS_2D: DisplaySlider = { key: "focusZoom", label: "Focus zoom", min: 1, max: 8, step: 0.1 };
// prettier-ignore
const FOCUS_3D: DisplaySlider = { key: "focusZoom", label: "Focus distance", min: 40, max: 600, step: 10 };

// glow/halo knobs only exist in the WebGL view
const DISPLAY_3D_ONLY: DisplaySlider[] = [
  { key: "nodeOpacity", label: "Node opacity", min: 0.05, max: 1, step: 0.05 },
  { key: "linkOpacity", label: "Link opacity", min: 0.05, max: 1, step: 0.05 },
  { key: "haloPad", label: "Halo padding", min: 1, max: 2, step: 0.05 },
  { key: "haloBase", label: "Halo base size", min: 0, max: 50, step: 1 },
  { key: "haloOpacity", label: "Halo opacity", min: 0, max: 1, step: 0.05 },
];

const FORCE_SLIDERS: SliderSpec<keyof ForceSettings>[] = [
  { key: "centerStrength", label: "Center force", min: 0, max: 1, step: 0.05 },
  { key: "repelStrength", label: "Repel force", min: 0, max: 20, step: 1 },
  { key: "linkStrength", label: "Link force", min: 0, max: 1, step: 0.1 },
  { key: "linkDistance", label: "Link distance", min: 10, max: 100, step: 1 },
];

type Props = {
  settings: Settings;
  activeId: string | null; // groups are edited for the open workspace
  search: string; // transient, owned by App — never persisted
  onSearchChange: (text: string) => void;
  onSettingsChange: (s: Settings) => void;
  // hand control is not a plain setting write: it also starts/stops this
  // session's camera, so it goes through App rather than onSettingsChange
  onHandControl: (on: boolean) => void;
  onResetHighlights: () => void; // ↺ also clears rings/trail
  onClose: () => void;
  showSections: boolean; // code workspaces have no raw/wiki sections
};

export default function GraphSettingsPanel({
  settings,
  activeId,
  search,
  onSearchChange,
  onSettingsChange,
  onHandControl,
  onResetHighlights,
  onClose,
  showSections,
}: Props) {
  const set = (patch: Partial<Settings>) =>
    onSettingsChange({ ...settings, ...patch });
  // display + forces edit the active view (2d/3d); the 3D toggle swaps which
  const dim = settings.dimensions;
  const view = settings.views[dim];
  const setView = (patch: Partial<ViewSettings>) =>
    set({
      views: {
        ...settings.views,
        [dim]: { ...view, ...patch },
      },
    });
  const setDisplay = (patch: Partial<DisplaySettings>) =>
    setView({ display: { ...view.display, ...patch } });
  const setForces = (patch: Partial<ForceSettings>) =>
    setView({ forces: { ...view.forces, ...patch } });
  const displaySliders =
    dim === "3d"
      ? [...BASE_DISPLAY, FOCUS_3D, ...DISPLAY_3D_ONLY]
      : [...BASE_DISPLAY, FOCUS_2D];
  const groups = (activeId && settings.groups[activeId]) || [];
  const setGroups = (next: GraphGroup[]) =>
    activeId && set({ groups: { ...settings.groups, [activeId]: next } });
  const setGroup = (i: number, patch: Partial<GraphGroup>) =>
    setGroups(groups.map((g, j) => (j === i ? { ...g, ...patch } : g)));

  return (
    <div className="fixed top-[50px] right-3 z-50 max-h-[calc(100vh-62px)] w-[260px] overflow-y-auto rounded-lg border border-edge bg-panel px-3 py-2.5 font-sans text-[13px] text-ink">
      <div className="flex justify-end gap-1.5">
        <button
          className="cursor-pointer text-sm text-ink-dim hover:text-accent"
          title="Restore defaults"
          onClick={() => {
            // reset re-tunes values; it must not eject the user from the 3D
            // view, wipe their (auto-seeded) groups, or silently claim the
            // camera is off — hand control is a mode, and this path can't
            // stop the tracker (it doesn't go through onHandControl)
            onSettingsChange({
              ...defaultSettings(),
              dimensions: settings.dimensions,
              groups: settings.groups,
              handControl: settings.handControl,
            });
            onSearchChange("");
            onResetHighlights();
          }}
        >
          ↺
        </button>
        <button
          className="cursor-pointer text-sm text-ink-dim hover:text-accent"
          title="Close"
          onClick={onClose}
        >
          ✕
        </button>
      </div>

      <details open className="border-t border-edge py-2">
        <summary className="mb-1.5 cursor-pointer font-semibold">
          Filters
        </summary>
        <input
          className="mb-2 w-full rounded-md border border-edge bg-abyss px-2 py-1.5 text-ink placeholder:text-ink-dim focus:border-accent focus:outline-none"
          placeholder="Search files…"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
        />
        <label className="flex items-center justify-between gap-2 py-1 text-ink-muted">
          Tags
          <input
            type="checkbox"
            className="gs-switch"
            checked={settings.showTags}
            onChange={(e) => set({ showTags: e.target.checked })}
          />
        </label>
        <label className="flex items-center justify-between gap-2 py-1 text-ink-muted">
          Orphans
          <input
            type="checkbox"
            className="gs-switch"
            checked={settings.showOrphans}
            onChange={(e) => set({ showOrphans: e.target.checked })}
          />
        </label>
        {showSections && (
          <div className="flex items-center justify-between gap-2 py-1 text-ink-muted">
            Sections
            <Segmented
              options={SECTION_OPTIONS}
              value={settings.sectionFilter}
              onChange={(f) => set({ sectionFilter: f })}
            />
          </div>
        )}
      </details>

      <details open className="border-t border-edge py-2">
        <summary className="mb-1.5 cursor-pointer font-semibold">
          Groups
        </summary>
        {groups.map((g, i) => (
          <div
            className="flex items-center justify-between gap-2 py-1 text-ink-muted"
            key={i}
          >
            <input
              className="min-w-0 flex-1 rounded-md border border-edge bg-abyss px-1.5 py-1 text-ink placeholder:text-ink-dim focus:border-accent focus:outline-none"
              placeholder="path or text…"
              value={g.query}
              onChange={(e) => setGroup(i, { query: e.target.value })}
            />
            <input
              type="color"
              className="h-[22px] w-[26px] cursor-pointer border-none bg-transparent p-0"
              value={g.color}
              onChange={(e) => setGroup(i, { color: e.target.value })}
            />
            <button
              className="cursor-pointer text-ink-dim hover:text-warm"
              title="Remove group"
              onClick={() => setGroups(groups.filter((_, j) => j !== i))}
            >
              ✕
            </button>
          </div>
        ))}
        <button
          className="mt-1.5 w-full cursor-pointer rounded-md bg-edge py-1.5 text-ink transition-colors hover:bg-edge/80"
          onClick={() =>
            setGroups([...groups, { query: "", color: randomColor() }])
          }
        >
          New group
        </button>
      </details>

      <details open className="border-t border-edge py-2">
        <summary className="mb-1.5 cursor-pointer font-semibold">
          Display ({dim.toUpperCase()})
        </summary>
        <label className="flex items-center justify-between gap-2 py-1 text-ink-muted">
          3D
          <input
            type="checkbox"
            className="gs-switch"
            checked={settings.dimensions === "3d"}
            onChange={(e) =>
              set({ dimensions: e.target.checked ? "3d" : "2d" })
            }
          />
        </label>
        {displaySliders.map(({ key, ...s }) => (
          <Slider
            key={key}
            {...s}
            value={view.display[key]}
            onChange={(v) => setDisplay({ [key]: v })}
          />
        ))}
      </details>

      <details className="border-t border-edge py-2">
        <summary className="mb-1.5 cursor-pointer font-semibold">
          Forces ({dim.toUpperCase()})
        </summary>
        {FORCE_SLIDERS.map(({ key, ...s }) => (
          <Slider
            key={key}
            {...s}
            value={view.forces[key]}
            onChange={(v) => setForces({ [key]: v })}
          />
        ))}
      </details>

      <label className="flex items-center justify-between gap-2 border-t border-edge py-2 text-ink-muted">
        Hand control
        <input
          type="checkbox"
          data-testid="hand-control-setting"
          className="gs-switch"
          checked={settings.handControl}
          onChange={(e) => onHandControl(e.target.checked)}
        />
      </label>
    </div>
  );
}

function Slider({
  label,
  min,
  max,
  step,
  value,
  onChange,
}: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="block py-1 text-ink-muted">
      {label}
      <input
        type="range"
        className="w-full accent-accent"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}
