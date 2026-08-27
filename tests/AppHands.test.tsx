// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/no-explicit-any */
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { defaultSettings } from "../src/shared/types";
import type { Settings } from "../src/shared/types";

// heavy visual children are stubs — this suite is about App's hand-control
// wiring, which lives entirely in App state + the real HandToggle
// hoisted: vi.mock factories are lifted above this file's top-level consts
const nullComponent = vi.hoisted(() => ({ default: () => null }));
vi.mock("../src/renderer/graph/Graph", () => ({
  default: () => null,
  PAN_PX_PER_UNIT: 900,
}));
vi.mock("../src/renderer/graph/Graph3D", () => nullComponent);
vi.mock("../src/renderer/graph/FleetGraph", () => nullComponent);
vi.mock("../src/renderer/home/Ring", () => nullComponent);
vi.mock("../src/renderer/home/MissionControl", () => ({
  default: () => null,
  DOT: {},
}));
vi.mock("../src/renderer/home/WorkspaceRail", () => nullComponent);
vi.mock("../src/renderer/terminal/TerminalPanel", () => nullComponent);
vi.mock("../src/renderer/preview/Preview", () => nullComponent);
vi.mock("../src/renderer/session/Timeline", () => nullComponent);
vi.mock("../src/renderer/graph/GraphSlot", () => ({
  default: ({
    children,
  }: {
    children: (s: { width: number; height: number }) => React.ReactNode;
  }) => <>{children({ width: 800, height: 600 })}</>,
}));

const tracker = vi.hoisted(() => ({
  stop: vi.fn(),
  starts: 0,
  impl: null as null | (() => Promise<() => void>),
}));
vi.mock("../src/renderer/hands/hand-tracker", () => ({
  startHandTracker: () => {
    tracker.starts++;
    return tracker.impl
      ? tracker.impl()
      : Promise.reject(new Error("No camera available"));
  },
}));

import App from "../src/renderer/App";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let settingsOnDisk: Settings;
const setSettings = vi.fn(() => Promise.resolve());

let root: Root;
let container: HTMLDivElement;
// App renders the voice wave onto a canvas, and jsdom has no 2D backend —
// without this, every render logs "Not implemented: getContext". VoiceWave
// already treats a null context as "no wave to draw"; tests/voice/VoiceWave
// is where the drawing itself is checked.
(HTMLCanvasElement.prototype as any).getContext = () => null;

beforeEach(() => {
  tracker.stop.mockClear();
  tracker.starts = 0;
  tracker.impl = null;
  setSettings.mockClear();
  settingsOnDisk = defaultSettings();
  (window as any).jarvis = {
    getWorkspaces: () => Promise.resolve([]),
    getSettings: () => Promise.resolve(settingsOnDisk),
    setSettings,
    addProject: () => Promise.resolve([]),
    onGraph: () => () => undefined,
    onToolEvent: () => () => undefined,
    onStatus: () => () => undefined,
    onSay: () => () => undefined,
    ttsVoices: () => Promise.resolve([]),
    ttsModels: () => Promise.resolve([]),
  };
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

const byTestId = (id: string) =>
  container.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
const mount = async () => {
  await act(async () => {
    root.render(<App />);
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

describe("App: hand control", () => {
  it("auto-starts the camera at launch when the setting is on — and Cards claims no gestures", async () => {
    settingsOnDisk = { ...defaultSettings(), handControl: true };
    tracker.impl = () => Promise.resolve(tracker.stop);
    await mount();
    expect(tracker.starts).toBe(1);
    expect(byTestId("hand-glyph")!.className).not.toContain("animate-pulse");
    expect(byTestId("hand-toggle")!.getAttribute("title")).toContain(
      "no gestures",
    );
  });

  it("stays dark when the setting is off", async () => {
    await mount();
    expect(tracker.starts).toBe(0);
    expect(byTestId("hand-toggle")).toBeTruthy(); // the button is never hidden
  });

  it("the ✋ button turns it off and persists the preference", async () => {
    settingsOnDisk = { ...defaultSettings(), handControl: true };
    tracker.impl = () => Promise.resolve(tracker.stop);
    await mount();
    await act(async () => {
      byTestId("hand-toggle")!.click();
    });
    expect(tracker.stop).toHaveBeenCalled();
    expect(setSettings).toHaveBeenCalledWith(
      expect.objectContaining({ handControl: false }),
    );
  });

  it("the settings-panel checkbox is the second affordance onto the same value", async () => {
    settingsOnDisk = { ...defaultSettings(), handControl: true };
    tracker.impl = () => Promise.resolve(tracker.stop);
    await mount();
    await act(async () => {
      (
        container.querySelector('[title="Graph settings"]') as HTMLElement
      ).click();
    });
    await act(async () => {
      byTestId("hand-control-setting")!.click();
    });
    expect(tracker.stop).toHaveBeenCalled();
    expect(setSettings).toHaveBeenCalledWith(
      expect.objectContaining({ handControl: false }),
    );
  });

  it("a tracker failure at launch stops this session's camera and leaves the setting alone", async () => {
    settingsOnDisk = { ...defaultSettings(), handControl: true };
    tracker.impl = null; // rejects: "No camera available"
    await mount();
    expect(byTestId("hand-toggle")!.getAttribute("title")).toContain(
      "No camera available",
    );
    expect(setSettings).not.toHaveBeenCalled(); // preference untouched

    // …and ✋ retries: cameraOn is false while the setting is still true, so
    // the click must restart the tracker without writing settings. Persisting
    // only inside a value-changed guard would leave the button dead here.
    await act(async () => {
      tracker.impl = () => Promise.resolve(tracker.stop);
    });
    await act(async () => {
      byTestId("hand-toggle")!.click();
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(tracker.starts).toBe(2);
    expect(byTestId("hand-toggle")!.getAttribute("title")).toContain(
      "Hand control on",
    ); // the error cleared
    expect(setSettings).not.toHaveBeenCalled();
  });

  it("the pulse follows the view: Ring registers actions, Cards does not", async () => {
    settingsOnDisk = { ...defaultSettings(), handControl: true };
    tracker.impl = () => Promise.resolve(tracker.stop);
    await mount();
    const ringBtn = [...container.querySelectorAll("button")].find(
      (b) => b.textContent === "Ring",
    ) as HTMLElement;
    await act(async () => {
      ringBtn.click();
    });
    expect(byTestId("hand-glyph")!.className).toContain("animate-pulse");
  });
});
