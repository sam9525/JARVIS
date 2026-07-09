import React from "react";
import { defaultSettings } from "../shared/types";
import type {
  DisplaySettings,
  ForceSettings,
  GraphGroup,
  Settings,
  ViewSettings,
} from "../shared/types";
import { PALETTE } from "./domain-colors";
import SectionToggle from "./SectionToggle";

type Props = {
  settings: Settings;
  search: string; // transient, owned by App — never persisted
  onSearchChange: (text: string) => void;
  onSettingsChange: (s: Settings) => void;
  onClose: () => void;
};

export default function GraphSettingsPanel({
  settings,
  search,
  onSearchChange,
  onSettingsChange,
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
    <div className="graph-settings">
      <div className="graph-settings-header">
        <button
          title="Restore defaults"
          onClick={() => {
            onSettingsChange(defaultSettings());
            onSearchChange("");
          }}
        >
          ↺
        </button>
        <button title="Close" onClick={onClose}>
          ✕
        </button>
      </div>

      <details open>
        <summary>Filters</summary>
        <input
          className="gs-search"
          placeholder="Search files…"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
        />
        <label className="gs-row">
          Tags
          <input
            type="checkbox"
            className="gs-switch"
            checked={settings.showTags}
            onChange={(e) => set({ showTags: e.target.checked })}
          />
        </label>
        <label className="gs-row">
          Orphans
          <input
            type="checkbox"
            className="gs-switch"
            checked={settings.showOrphans}
            onChange={(e) => set({ showOrphans: e.target.checked })}
          />
        </label>
        <div className="gs-row">
          Sections
          <SectionToggle
            value={settings.sectionFilter}
            onChange={(f) => set({ sectionFilter: f })}
          />
        </div>
      </details>

      <details open>
        <summary>Groups</summary>
        {settings.groups.map((g, i) => (
          <div className="gs-row" key={i}>
            <input
              className="gs-group-query"
              placeholder="path or text…"
              value={g.query}
              onChange={(e) => setGroup(i, { query: e.target.value })}
            />
            <input
              type="color"
              value={g.color}
              onChange={(e) => setGroup(i, { color: e.target.value })}
            />
            <button
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
          className="gs-new-group"
          onClick={() =>
            set({
              groups: [
                ...settings.groups,
                {
                  query: "",
                  color: PALETTE[settings.groups.length % PALETTE.length],
                },
              ],
            })
          }
        >
          New group
        </button>
      </details>

      <details open>
        <summary>Display ({settings.dimensions.toUpperCase()})</summary>
        <label className="gs-row">
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
      </details>

      <details>
        <summary>Forces ({settings.dimensions.toUpperCase()})</summary>
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
    <label className="gs-slider">
      {label}
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}
