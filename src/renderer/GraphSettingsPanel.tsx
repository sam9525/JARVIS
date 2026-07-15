import React from "react";
import { defaultSettings } from "../shared/types";
import type {
  DisplaySettings,
  ForceSettings,
  GraphGroup,
  Settings,
  ViewSettings,
} from "../shared/types";
import { randomColor } from "../shared/random-color";
import SectionToggle from "./SectionToggle";

type Props = {
  settings: Settings;
  search: string; // transient, owned by App — never persisted
  onSearchChange: (text: string) => void;
  onSettingsChange: (s: Settings) => void;
  onResetHighlights: () => void; // ↺ also clears rings/trail
  onClose: () => void;
};

export default function GraphSettingsPanel({
  settings,
  search,
  onSearchChange,
  onSettingsChange,
  onResetHighlights,
  onClose,
}: Props) {
  const set = (patch: Partial<Settings>) =>
    onSettingsChange({ ...settings, ...patch });
  // display + forces edit the active view (2d/3d); the toggle below swaps which
  const view = settings.views[settings.dimensions];
  const setView = (patch: Partial<ViewSettings>) =>
    set({
      views: {
        ...settings.views,
        [settings.dimensions]: { ...view, ...patch },
      },
    });
  const setDisplay = (patch: Partial<DisplaySettings>) =>
    setView({ display: { ...view.display, ...patch } });
  const setForces = (patch: Partial<ForceSettings>) =>
    setView({ forces: { ...view.forces, ...patch } });
  const setGroup = (i: number, patch: Partial<GraphGroup>) =>
    set({
      groups: settings.groups.map((g, j) => (j === i ? { ...g, ...patch } : g)),
    });

  return (
    <div className="fixed top-[50px] right-3 max-h-[calc(100vh-62px)] w-[260px] overflow-y-auto rounded-lg border border-edge bg-panel px-3 py-2.5 font-sans text-[13px] text-ink">
      <div className="flex justify-end gap-1.5">
        <button
          className="cursor-pointer text-sm text-ink-dim hover:text-accent"
          title="Restore defaults"
          onClick={() => {
            // reset re-tunes values; it must not eject the user from the 3D
            // view or wipe their (auto-seeded) groups
            onSettingsChange({
              ...defaultSettings(),
              dimensions: settings.dimensions,
              groups: settings.groups,
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
        <div className="flex items-center justify-between gap-2 py-1 text-ink-muted">
          Sections
          <SectionToggle
            value={settings.sectionFilter}
            onChange={(f) => set({ sectionFilter: f })}
          />
        </div>
      </details>

      <details open className="border-t border-edge py-2">
        <summary className="mb-1.5 cursor-pointer font-semibold">
          Groups
        </summary>
        {settings.groups.map((g, i) => (
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
              onClick={() =>
                set({ groups: settings.groups.filter((_, j) => j !== i) })
              }
            >
              ✕
            </button>
          </div>
        ))}
        <button
          className="mt-1.5 w-full cursor-pointer rounded-md bg-edge py-1.5 text-ink transition-colors hover:bg-edge/80"
          onClick={() =>
            set({
              groups: [...settings.groups, { query: "", color: randomColor() }],
            })
          }
        >
          New group
        </button>
      </details>

      <details open className="border-t border-edge py-2">
        <summary className="mb-1.5 cursor-pointer font-semibold">
          Display ({settings.dimensions.toUpperCase()})
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
        <Slider
          label="Text fade threshold"
          min={2}
          max={30}
          step={1}
          value={view.display.textFadeThreshold}
          onChange={(v) => setDisplay({ textFadeThreshold: v })}
        />
        <Slider
          label="Node size"
          min={0.5}
          max={3}
          step={0.1}
          value={view.display.nodeSize}
          onChange={(v) => setDisplay({ nodeSize: v })}
        />
        <Slider
          label="Link thickness"
          min={0.5}
          max={4}
          step={0.1}
          value={view.display.linkThickness}
          onChange={(v) => setDisplay({ linkThickness: v })}
        />
        {settings.dimensions === "3d" ? (
          <Slider
            label="Focus distance"
            min={40}
            max={600}
            step={10}
            value={view.display.focusZoom}
            onChange={(v) => setDisplay({ focusZoom: v })}
          />
        ) : (
          <Slider
            label="Focus zoom"
            min={1}
            max={8}
            step={0.1}
            value={view.display.focusZoom}
            onChange={(v) => setDisplay({ focusZoom: v })}
          />
        )}
        {settings.dimensions === "3d" && (
          <>
            <Slider
              label="Node opacity"
              min={0.05}
              max={1}
              step={0.05}
              value={view.display.nodeOpacity}
              onChange={(v) => setDisplay({ nodeOpacity: v })}
            />
            <Slider
              label="Link opacity"
              min={0.05}
              max={1}
              step={0.05}
              value={view.display.linkOpacity}
              onChange={(v) => setDisplay({ linkOpacity: v })}
            />
            <Slider
              label="Halo padding"
              min={1}
              max={2}
              step={0.05}
              value={view.display.haloPad}
              onChange={(v) => setDisplay({ haloPad: v })}
            />
            <Slider
              label="Halo base size"
              min={0}
              max={50}
              step={1}
              value={view.display.haloBase}
              onChange={(v) => setDisplay({ haloBase: v })}
            />
          </>
        )}
      </details>

      <details className="border-t border-edge py-2">
        <summary className="mb-1.5 cursor-pointer font-semibold">
          Forces ({settings.dimensions.toUpperCase()})
        </summary>
        <Slider
          label="Center force"
          min={0}
          max={1}
          step={0.05}
          value={view.forces.centerStrength}
          onChange={(v) => setForces({ centerStrength: v })}
        />
        <Slider
          label="Repel force"
          min={0}
          max={20}
          step={1}
          value={view.forces.repelStrength}
          onChange={(v) => setForces({ repelStrength: v })}
        />
        <Slider
          label="Link force"
          min={0}
          max={1}
          step={0.1}
          value={view.forces.linkStrength}
          onChange={(v) => setForces({ linkStrength: v })}
        />
        <Slider
          label="Link distance"
          min={10}
          max={100}
          step={1}
          value={view.forces.linkDistance}
          onChange={(v) => setForces({ linkDistance: v })}
        />
      </details>
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
