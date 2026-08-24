// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/no-explicit-any */
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import GraphSettingsPanel from "../../src/renderer/ui/GraphSettingsPanel";
import { defaultSettings } from "../../src/shared/types";
import type { Settings } from "../../src/shared/types";

// this suite mounts GraphSettingsPanel for real: Task 5 gives it useState
// calls that only run inside React's render loop, so a bare function call
// (no fiber, no dispatcher) throws. useMicDevices still needs a mock — jsdom
// has no navigator.mediaDevices for it to call.
vi.mock("../../src/renderer/voice/use-mic-devices", () => ({
  useMicDevices: () => [],
}));

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

// the cloud-voice section calls these on mount and on save/clear; stub them
// so the panel's own useEffect has something to resolve
(globalThis as any).window.jarvis = {
  ttsKeyState: () => Promise.resolve({ hasKey: false, encrypted: false }),
  ttsSetKey: () => Promise.resolve({ hasKey: false, encrypted: false }),
  ttsVoices: () => Promise.resolve([]),
  ttsModels: () => Promise.resolve([]),
};

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  act(() => {
    root = createRoot(container);
  });
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

type MountProps = Partial<{
  settings: Settings;
  activeId: string | null;
  search: string;
  onSearchChange: (s: string) => void;
  onSettingsChange: (s: Settings) => void;
  onHandControl: (on: boolean) => void;
  onVoiceControl: (on: boolean) => void;
  onResetHighlights: () => void;
  showSections: boolean;
}>;

function mount(props: MountProps = {}) {
  act(() => {
    root.render(
      <GraphSettingsPanel
        settings={props.settings ?? defaultSettings()}
        activeId={props.activeId ?? "ws1"}
        search={props.search ?? "abc"}
        onSearchChange={props.onSearchChange ?? (() => undefined)}
        onSettingsChange={props.onSettingsChange ?? (() => undefined)}
        onHandControl={props.onHandControl ?? (() => undefined)}
        onVoiceControl={props.onVoiceControl ?? (() => undefined)}
        onResetHighlights={props.onResetHighlights ?? (() => undefined)}
        showSections={props.showSections ?? true}
      />,
    );
  });
  return container;
}

function render(overrides: Partial<Settings> = {}) {
  const calls: {
    settings: Settings[];
    search: string[];
    resets: number;
  } = {
    settings: [],
    search: [],
    resets: 0,
  };
  mount({
    settings: { ...defaultSettings(), ...overrides },
    onSearchChange: (s) => calls.search.push(s),
    onSettingsChange: (s) => calls.settings.push(s),
    onResetHighlights: () => {
      calls.resets++;
    },
  });
  return { container, calls };
}

// find a top-level <details> section by its summary text (a prefix match,
// since Display/Forces summaries append "(2D)"/"(3D)")
function detailsSection(scope: Element, label: string): HTMLDetailsElement {
  const found = Array.from(scope.querySelectorAll("details")).find((d) =>
    d.querySelector("summary")?.textContent?.trim().startsWith(label),
  );
  if (!found) throw new Error(`no <details> section labeled "${label}"`);
  return found as HTMLDetailsElement;
}

// sliders render from a spec array, so find them by their visible label
// text rather than by position within the section
function sliderInputs(section: Element): HTMLInputElement[] {
  return Array.from(
    section.querySelectorAll('label > input[type="range"]'),
  ) as HTMLInputElement[];
}

function sliderLabels(section: Element): string[] {
  return sliderInputs(section).map((input) =>
    input.parentElement!.textContent!.trim(),
  );
}

function sliderByLabel(section: Element, label: string): HTMLInputElement {
  const found = sliderInputs(section).find(
    (input) => input.parentElement!.textContent!.trim() === label,
  );
  if (!found) throw new Error(`no slider labeled "${label}"`);
  return found;
}

// React tracks the DOM value/checked property it last saw, so writing the
// property directly (without going through the prototype's own setter) is
// invisible to it and no event fires. Bypass that tracker the way every
// DOM-testing helper does: call the native setter, then dispatch the event.
const nativeValueSetter = Object.getOwnPropertyDescriptor(
  HTMLInputElement.prototype,
  "value",
)!.set!;

function changeRange(input: HTMLInputElement, value: number) {
  act(() => {
    nativeValueSetter.call(input, String(value));
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

// force the checkbox to the opposite of the target state, then click it —
// a real click() toggles `.checked` and fires the native events React's
// checkbox handling listens for, so the result lands on `checked` regardless
// of which state the box started in
function setChecked(checkbox: HTMLInputElement, checked: boolean) {
  act(() => {
    checkbox.checked = !checked;
    checkbox.click();
  });
}

describe("GraphSettingsPanel", () => {
  it("renders header + four sections, Forces collapsed by default", () => {
    render();
    const panel = container.firstElementChild!;
    // [header, Filters, Groups, Display, Forces, hand control, voice control,
    //  microphone, no-devices hint, cloud voice]
    expect(panel.children).toHaveLength(10);
    const forces = detailsSection(container, "Forces");
    expect(forces.tagName).toBe("DETAILS");
    expect(forces.open).toBe(false); // collapsed by default
    expect(detailsSection(container, "Filters").open).toBe(true);
  });

  it("reset restores defaults but keeps dimensions, groups, hand control, mic and cloud voice choices", () => {
    const groups = { ws1: [{ query: "tech/", color: "#aa00ff" }] };
    const { container, calls } = render({
      showTags: false,
      dimensions: "3d",
      groups,
      handControl: true,
      micDeviceId: "mic-1",
      ttsVoiceId: "voice-1",
      ttsModelId: "model-1",
    });
    const resetBtn = container.querySelector(
      'button[title="Restore defaults"]',
    ) as HTMLButtonElement;
    // handControl survives: this path can't stop the camera, so resetting it
    // would leave the webcam live behind an unticked box. mic/voice/model are
    // device and account choices, not graph tuning, so they survive too.
    act(() => resetBtn.click());
    expect(calls.settings[0]).toEqual({
      ...defaultSettings(),
      dimensions: "3d",
      groups,
      handControl: true,
      micDeviceId: "mic-1",
      ttsVoiceId: "voice-1",
      ttsModelId: "model-1",
    });
    expect(calls.search[0]).toBe("");
    expect(calls.resets).toBe(1);
  });

  it("new group gets a random hex color and empty query", () => {
    const { container, calls } = render();
    const groupsSection = detailsSection(container, "Groups");
    const newGroupBtn = Array.from(
      groupsSection.querySelectorAll("button"),
    ).find((b) => b.textContent === "New group") as HTMLButtonElement;
    act(() => newGroupBtn.click());
    expect(calls.settings[0].groups.ws1).toHaveLength(1);
    expect(calls.settings[0].groups.ws1[0].query).toBe("");
    expect(calls.settings[0].groups.ws1[0].color).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("3D toggle switches dimensions", () => {
    const { container, calls } = render();
    const display = detailsSection(container, "Display");
    const label = Array.from(display.querySelectorAll("label")).find(
      (l) => l.textContent?.trim() === "3D",
    ) as HTMLLabelElement;
    const input = label.querySelector(
      'input[type="checkbox"]',
    ) as HTMLInputElement;
    setChecked(input, true);
    expect(calls.settings[0].dimensions).toBe("3d");
  });

  it("display sliders edit the active view only", () => {
    const { container, calls } = render({ dimensions: "3d" });
    const display = detailsSection(container, "Display");
    changeRange(sliderByLabel(display, "Node size"), 2.5);
    expect(calls.settings[0].views["3d"].display.nodeSize).toBe(2.5);
    expect(calls.settings[0].views["2d"].display.nodeSize).toBe(1); // untouched
  });

  it("focus slider follows the active dimension and edits only that view", () => {
    // 2D: labelled "Focus zoom", and the 3D-only knobs stay out
    const twoD = render({ dimensions: "2d" });
    const twoDDisplay = detailsSection(twoD.container, "Display");
    const twoDLabels = sliderLabels(twoDDisplay);
    expect(twoDLabels).toContain("Focus zoom");
    expect(twoDLabels).not.toContain("Focus distance");
    expect(twoDLabels).not.toContain("Halo opacity");
    changeRange(sliderByLabel(twoDDisplay, "Focus zoom"), 4);
    expect(twoD.calls.settings[0].views["2d"].display.focusZoom).toBe(4);
    expect(twoD.calls.settings[0].views["3d"].display.focusZoom).toBe(180);

    // 3D: label "Focus distance", plus the halo/opacity knobs
    const threeD = render({ dimensions: "3d" });
    const threeDDisplay = detailsSection(threeD.container, "Display");
    const threeDLabels = sliderLabels(threeDDisplay);
    expect(threeDLabels).toContain("Focus distance");
    expect(threeDLabels).not.toContain("Focus zoom");
    expect(threeDLabels).toContain("Halo opacity");
    changeRange(sliderByLabel(threeDDisplay, "Focus distance"), 200);
    expect(threeD.calls.settings[0].views["3d"].display.focusZoom).toBe(200);
    expect(threeD.calls.settings[0].views["2d"].display.focusZoom).toBe(6.8);
  });

  it("reports a voice control change", () => {
    let got: boolean | null = null;
    mount({
      settings: defaultSettings(),
      search: "",
      onVoiceControl: (on) => {
        got = on;
      },
    });
    const input = container.querySelector(
      '[data-testid="voice-control-setting"]',
    ) as HTMLInputElement;
    setChecked(input, true);
    expect(got).toBe(true);
  });

  it("reset keeps voice control, since that path cannot stop the mic", () => {
    const { container, calls } = render({ voiceControl: true });
    // click the reset button the same way the hand-control reset test does
    const resetBtn = container.querySelector(
      'button[title="Restore defaults"]',
    ) as HTMLButtonElement;
    act(() => resetBtn.click());
    expect(calls.settings[0].voiceControl).toBe(true);
  });
});
