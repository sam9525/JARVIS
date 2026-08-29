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

// the cloud-voice section calls these on mount; stub them as vi.fn()s so
// individual tests can control what the "account" returns
const ttsVoices = vi.fn();
const ttsModels = vi.fn();
const listHeadModels = vi.fn();
const pickHeadModel = vi.fn();
(globalThis as any).window.jarvis = {
  ttsVoices,
  ttsModels,
  listHeadModels,
  pickHeadModel,
};

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  ttsVoices.mockReset().mockResolvedValue([]);
  ttsModels.mockReset().mockResolvedValue([]);
  listHeadModels.mockReset().mockResolvedValue([]);
  pickHeadModel.mockReset().mockResolvedValue(null);
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

// lets pending .then()/.catch() microtasks from the panel's effects settle
// and their state updates commit before the test inspects the DOM
async function flush() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

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

// the panel is two pages; everything hand/voice/head lives behind the
// "Senses" tab, so a test that wants those must switch first
function senses(scope: Element = container) {
  const tab = Array.from(scope.querySelectorAll("button")).find(
    (b) => b.textContent === "Senses",
  ) as HTMLButtonElement;
  act(() => tab.click());
  return scope;
}

describe("GraphSettingsPanel", () => {
  it("puts hand, voice and head behind the Senses tab", () => {
    render();
    expect(
      container.querySelector('[data-testid="voice-control-setting"]'),
    ).toBeNull();
    senses();
    // [header, hand control, voice control, microphone, no-devices hint,
    //  head model, head upload, colour head, cloud voice]
    expect(container.firstElementChild!.children).toHaveLength(9);
    expect(
      container.querySelector('[data-testid="voice-control-setting"]'),
    ).not.toBeNull();
    expect(detailsSection(container, "Cloud voice")).toBeTruthy();
  });

  it("renders header + the four graph sections, Forces collapsed by default", () => {
    render();
    const panel = container.firstElementChild!;
    // [header, Filters, Groups, Display, Forces] — the senses page is behind
    // its own tab
    expect(panel.children).toHaveLength(5);
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
    const input = senses().querySelector(
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

  it("populates the voice and model dropdowns from the account, not a hardcoded list", async () => {
    ttsVoices.mockResolvedValue([
      { id: "v2", name: "My Clone", mine: true },
      { id: "v1", name: "Rachel", mine: false },
    ]);
    ttsModels.mockResolvedValue([{ id: "m1", name: "Eleven Turbo v2.5" }]);
    const c = mount();
    await flush();
    const section = detailsSection(senses(c), "Cloud voice");
    expect(section.querySelector('[data-testid="tts-key-input"]')).toBeNull();
    const voiceSelect = section.querySelector(
      '[data-testid="tts-voice-setting"]',
    ) as HTMLSelectElement;
    const modelSelect = section.querySelector(
      '[data-testid="tts-model-setting"]',
    ) as HTMLSelectElement;
    expect(Array.from(voiceSelect.options).map((o) => o.textContent)).toEqual([
      "None — use the local voice",
      "My Clone",
      "Rachel",
    ]);
    // the account's own voices sit in their own titled group, above the
    // premade ones
    expect(
      Array.from(voiceSelect.querySelectorAll("optgroup")).map((g) => [
        g.label,
        Array.from(g.querySelectorAll("option")).map((o) => o.textContent),
      ]),
    ).toEqual([
      ["My voices", ["My Clone"]],
      ["ElevenLabs & library", ["Rachel"]],
    ]);
    expect(Array.from(modelSelect.options).map((o) => o.textContent)).toEqual([
      "Eleven Turbo v2.5",
    ]);
  });
});

describe("head model", () => {
  const select = (c: Element) =>
    c.querySelector('[data-testid="head-model-setting"]') as HTMLSelectElement;

  it("offers the built-in helmet and every uploaded model", async () => {
    listHeadModels.mockResolvedValue(["a.glb", "b.glb"]);
    const { container: c } = render();
    senses();
    await flush();
    expect(Array.from(select(c).options).map((o) => o.textContent)).toEqual([
      "Built-in helmet",
      "a",
      "b",
    ]);
  });

  it("keeps the saved name selectable before the list arrives", () => {
    const { container: c } = render({ headModel: "saved.glb" });
    senses();
    // no flush: the list is still in flight
    expect(select(c).value).toBe("saved.glb");
  });

  it("clears the setting when the built-in is chosen", async () => {
    const { container: c, calls } = render({ headModel: "a.glb" });
    senses();
    await flush();
    act(() => {
      select(c).value = "";
      select(c).dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(calls.settings.at(-1)?.headModel).toBeUndefined();
  });

  it("selects an uploaded model and refreshes the list", async () => {
    pickHeadModel.mockResolvedValue("new.glb");
    const { container: c, calls } = render();
    senses();
    await flush();
    const button = c.querySelector(
      '[data-testid="head-model-upload"]',
    ) as HTMLButtonElement;
    act(() => button.click());
    await flush();
    expect(calls.settings.at(-1)?.headModel).toBe("new.glb");
    expect(listHeadModels).toHaveBeenCalledTimes(2);
  });

  it("leaves the current head alone when the picker is cancelled", async () => {
    pickHeadModel.mockResolvedValue(null);
    const { container: c, calls } = render({ headModel: "a.glb" });
    senses();
    await flush();
    const button = c.querySelector(
      '[data-testid="head-model-upload"]',
    ) as HTMLButtonElement;
    act(() => button.click());
    await flush();
    expect(calls.settings).toHaveLength(0);
  });
});
