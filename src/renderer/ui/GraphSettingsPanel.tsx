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
import type { TtsOption } from "../../main/tts";
import type { RigKind } from "../voice/head-rig";
import { RECENT_PICKS, hueToHex, pickHue } from "../graph/workspace-color";
import { useMicDevices } from "../voice/use-mic-devices";
import Segmented from "./Segmented";

type Page = "graph" | "senses";

const PAGE_OPTIONS: { value: Page; label: string }[] = [
  { value: "graph", label: "Graph" },
  { value: "senses", label: "Senses" },
];

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
  // same reasoning as onHandControl: voice control also starts/stops this
  // session's microphone, so it goes through App rather than onSettingsChange
  onVoiceControl: (on: boolean) => void;
  onResetHighlights: () => void; // ↺ also clears rings/trail
  showSections: boolean; // code workspaces have no raw/wiki sections
  rigKind?: RigKind | null;
  // Null while voice is off: the switch stays live rather than claiming an
  // unloaded head has no colours, the same reasoning as rigKind above.
  headTextured?: boolean | null;
  onPickMouth?: () => void;
};

export default function GraphSettingsPanel({
  settings,
  activeId,
  search,
  onSearchChange,
  onSettingsChange,
  onHandControl,
  onVoiceControl,
  onResetHighlights,
  showSections,
  rigKind,
  headTextured,
  onPickMouth,
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

  const [page, setPage] = React.useState<Page>("graph");

  const mics = useMicDevices();
  // deviceId is "" and label is blank until permission has been granted once
  const named = mics.filter((d) => d.deviceId && d.label);
  const savedMic = settings.micDeviceId ?? "";
  const micValue = named.some((d) => d.deviceId === savedMic) ? savedMic : "";

  const [voices, setVoices] = React.useState<TtsOption[]>([]);
  const [models, setModels] = React.useState<TtsOption[]>([]);
  // main sorts the account's own voices first, so one split point separates
  // the two groups
  const mine = voices.filter((v) => v.mine);
  const premade = voices.filter((v) => !v.mine);
  // the lists come from the account, not a hardcoded table, so the dropdowns
  // only ever offer what the .env key can actually use. No key means main
  // answers with empty lists — a rejected fetch does the same, there is no
  // error surface here.
  React.useEffect(() => {
    void window.jarvis
      .ttsVoices()
      .then(setVoices)
      .catch(() => setVoices([]));
    void window.jarvis
      .ttsModels()
      .then(setModels)
      .catch(() => setModels([]));
  }, []);

  // Uploaded head models, by name. Main owns the folder, so this is the only
  // way to know what is in it.
  const [heads, setHeads] = React.useState<string[]>([]);
  const refreshHeads = React.useCallback(
    () =>
      void window.jarvis
        .listHeadModels()
        .then(setHeads)
        .catch(() => setHeads([])),
    [],
  );
  React.useEffect(refreshHeads, [refreshHeads]);
  const headValue = settings.headModel ?? "";
  // The list arrives a tick after the first render, so the saved name is kept
  // selectable meanwhile — otherwise the dropdown reads "Built-in" for a frame
  // while the setting says otherwise.
  const headOptions =
    headValue && !heads.includes(headValue) ? [headValue, ...heads] : heads;
  // A cancelled picker answers null, which must not clear the current head.
  const uploadHead = () =>
    void window.jarvis.pickHeadModel().then((name) => {
      if (!name) return;
      refreshHeads();
      set({ headModel: name });
    });

  return (
    <div className="h-full overflow-y-auto px-3 py-2.5 font-sans text-[13px] text-ink">
      <div className="mb-2.5 flex items-center justify-between gap-1.5">
        <Segmented options={PAGE_OPTIONS} value={page} onChange={setPage} />
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
              // the palette is identity, not tuning: a reset that repainted
              // every project would undo the one thing colours are for
              mainColors: settings.mainColors,
              recentHues: settings.recentHues,
              handControl: settings.handControl,
              voiceControl: settings.voiceControl,
              // both halves of the panel geometry, or the next resize rescales
              // from the default window instead of the one they were saved in
              panels: settings.panels,
              panelViewport: settings.panelViewport,
              // device and account choices, not graph tuning — a reset must
              // not silently drop the mic, voice, model or head the user picked
              micDeviceId: settings.micDeviceId,
              ttsVoiceId: settings.ttsVoiceId,
              ttsModelId: settings.ttsModelId,
              headModel: settings.headModel,
              headColor: settings.headColor,
              headMouth: settings.headMouth,
              headMouths: settings.headMouths,
            });
            onSearchChange("");
            onResetHighlights();
          }}
        >
          ↺
        </button>
      </div>

      {page === "graph" && (
        <>
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
              onClick={() => {
                if (!activeId) return;
                // Drawn against the shared pick log, not this workspace's own
                // colours: the log is what stops a hand-added group repeating a
                // green that another project drew a moment ago.
                const recent = settings.recentHues ?? [];
                const hue = pickHue(recent);
                set({
                  groups: {
                    ...settings.groups,
                    [activeId]: [
                      ...groups,
                      { query: "", color: hueToHex(hue) },
                    ],
                  },
                  recentHues: [...recent, hue].slice(-RECENT_PICKS),
                });
              }}
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
        </>
      )}

      {page === "senses" && (
        <>
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

          <label className="flex items-center justify-between gap-2 py-2 text-ink-muted">
            Voice control
            <input
              type="checkbox"
              data-testid="voice-control-setting"
              className="gs-switch"
              checked={settings.voiceControl}
              onChange={(e) => onVoiceControl(e.target.checked)}
            />
          </label>

          <label className="flex items-center justify-between gap-2 py-1 text-ink-muted">
            Microphone
            <select
              data-testid="mic-device-setting"
              className="max-w-[60%] cursor-pointer truncate rounded-md border border-edge bg-abyss py-1 pl-2 pr-6 text-ink focus:border-accent focus:outline-none"
              value={micValue}
              onChange={(e) =>
                set({ micDeviceId: e.target.value || undefined })
              }
            >
              <option value="">Default microphone</option>
              {named.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label}
                </option>
              ))}
            </select>
          </label>
          {named.length === 0 && (
            <div className="pb-2 text-[11.5px] text-ink-dim">
              Device names appear after you allow the microphone once.
            </div>
          )}

          <label className="flex items-center justify-between gap-2 py-1 text-ink-muted">
            Head
            <select
              data-testid="head-model-setting"
              className="max-w-[60%] cursor-pointer truncate rounded-md border border-edge bg-abyss py-1 pl-2 pr-6 text-ink focus:border-accent focus:outline-none"
              value={headValue}
              onChange={(e) => set({ headModel: e.target.value || undefined })}
            >
              <option value="">Built-in helmet</option>
              {headOptions.map((h) => (
                <option key={h} value={h}>
                  {h.replace(/\.glb$/i, "")}
                </option>
              ))}
            </select>
          </label>
          <button
            data-testid="head-model-upload"
            className="mb-1 w-full cursor-pointer rounded-md bg-edge py-1.5 text-ink transition-colors hover:bg-edge/80"
            title="Add a .glb head model"
            onClick={uploadHead}
          >
            Upload a .glb head
          </button>

          <label className="flex items-center justify-between gap-2 py-2 text-ink-muted">
            Colour head
            <input
              type="checkbox"
              data-testid="head-colour-setting"
              className="gs-switch"
              disabled={headTextured === false}
              checked={(settings.headColor ?? false) && headTextured !== false}
              onChange={(e) =>
                set({ headColor: e.target.checked || undefined })
              }
            />
          </label>
          {headTextured === false && (
            <div className="pb-2 text-[11.5px] text-ink-dim">
              This model carries no colour texture. Only the wireframe can draw
              it.
            </div>
          )}

          <label className="flex items-center justify-between gap-2 py-2 text-ink-muted">
            Mouth moves
            <input
              type="checkbox"
              data-testid="head-mouth-setting"
              className="gs-switch"
              disabled={rigKind === "none"}
              checked={(settings.headMouth ?? false) && rigKind !== "none"}
              onChange={(e) =>
                set({ headMouth: e.target.checked || undefined })
              }
            />
          </label>
          {rigKind === "none" && (
            <div className="pb-2 text-[11.5px] text-ink-dim">
              This model has no mouth. Pick one to give it a region to open.
            </div>
          )}
          <button
            data-testid="mouth-pick-open"
            className="mb-1 w-full cursor-pointer rounded-md bg-edge py-1.5 text-ink transition-colors hover:bg-edge/80"
            title="Mark where this model's mouth is"
            onClick={onPickMouth}
          >
            Pick the mouth…
          </button>

          <details className="border-t border-edge py-2">
            <summary className="mb-1.5 cursor-pointer font-semibold">
              Cloud voice
            </summary>
            {voices.length === 0 && models.length === 0 && (
              <div className="pb-1.5 text-[11.5px] text-ink-dim">
                Empty — set ELEVENLABS_API_KEY in .env. The key also needs the
                voices_read and models_read permissions.
              </div>
            )}
            <label className="flex items-center justify-between gap-2 py-1 text-ink-muted">
              Voice
              <select
                data-testid="tts-voice-setting"
                className="max-w-[60%] cursor-pointer truncate rounded-md border border-edge bg-abyss py-1 pl-2 pr-6 text-ink focus:border-accent focus:outline-none"
                value={settings.ttsVoiceId ?? ""}
                onChange={(e) =>
                  set({ ttsVoiceId: e.target.value || undefined })
                }
              >
                <option value="">None — use the local voice</option>
                {mine.length > 0 && (
                  <optgroup label="My voices">
                    {mine.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.name}
                      </option>
                    ))}
                  </optgroup>
                )}
                {premade.length > 0 && (
                  <optgroup label="ElevenLabs & library">
                    {premade.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.name}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
            </label>
            <label className="flex items-center justify-between gap-2 py-1 text-ink-muted">
              Model
              <select
                data-testid="tts-model-setting"
                className="max-w-[60%] cursor-pointer truncate rounded-md border border-edge bg-abyss py-1 pl-2 pr-6 text-ink focus:border-accent focus:outline-none"
                value={settings.ttsModelId ?? ""}
                onChange={(e) => set({ ttsModelId: e.target.value })}
              >
                {models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </label>
          </details>
        </>
      )}
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
