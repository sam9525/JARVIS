// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/no-explicit-any */
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { defaultSettings } from "../src/shared/types";
import type { Workspace } from "../src/shared/types";
import { parseTodos } from "../src/main/todos";

// heavy visual children are stubs — this suite is about App's to-do panels
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
vi.mock("../src/renderer/home/WorkspaceRail", () => ({
  default: () => null,
  railSeats: () => 1,
}));
vi.mock("../src/renderer/terminal/TerminalPanel", () => ({
  ...nullComponent,
  onTerminalTyped: () => () => undefined,
}));
vi.mock("../src/renderer/preview/Preview", () => nullComponent);
vi.mock("../src/renderer/session/Timeline", () => nullComponent);
vi.mock("../src/renderer/voice/VoiceWave", () => nullComponent);
vi.mock("../src/renderer/graph/GraphSlot", () => ({
  default: ({
    children,
  }: {
    children: (s: { width: number; height: number }) => React.ReactNode;
  }) => <>{children({ width: 800, height: 600 })}</>,
}));
vi.mock("../src/renderer/hands/hand-tracker", () => ({
  startHandTracker: () => Promise.resolve(() => undefined),
}));
vi.mock("../src/renderer/voice/voice-tracker", () => ({
  startVoiceTracker: () => Promise.resolve(() => undefined),
}));

import App from "../src/renderer/App";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const SELF: Workspace = {
  id: "ws-self",
  name: "Self",
  rootPath: "/self",
  kind: "vault",
  sourceId: "vault",
  isSelf: true,
};
const LIST = parseTodos("- [ ] Fix the ring snap @JARVIS 2026-09-27\n");

let showTodos: (() => void) | null = null;
const todoOp = vi.fn(() => Promise.resolve({ ok: true }));
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  todoOp.mockClear();
  (window as any).jarvis = {
    getWorkspaces: () => Promise.resolve([SELF]),
    getSettings: () => Promise.resolve(defaultSettings()),
    setSettings: () => Promise.resolve(),
    addProject: () => Promise.resolve([]),
    getGraph: () => Promise.resolve({ nodes: [], edges: [] }),
    getSymbolGraph: () => Promise.resolve({ nodes: [], edges: [] }),
    ptyInput: () => Promise.resolve(true),
    onGraph: () => () => undefined,
    onToolEvent: () => () => undefined,
    onStatus: () => () => undefined,
    onSay: () => () => undefined,
    ttsVoices: () => Promise.resolve([]),
    ttsModels: () => Promise.resolve([]),
    listHeadModels: () => Promise.resolve([]),
    getNotesDir: () => Promise.resolve(null),
    pickNotesDir: () => Promise.resolve(null),
    clearNotesDir: () => Promise.resolve(null),
    getTodos: () => Promise.resolve(LIST),
    todoOp,
    onTodos: () => () => undefined,
    onShowTodos: (cb: () => void) => {
      showTodos = cb;
      return () => undefined;
    },
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

const $ = (testId: string) =>
  container.querySelector(`[data-testid="${testId}"]`) as HTMLElement | null;
const button = (label: string) =>
  [...container.querySelectorAll("button")].find(
    (b) => b.textContent === label,
  ) as HTMLButtonElement;
// Panel unmounts on a timer once its exit animation has run
const exitPlayed = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 300));
  });

const openView = async () => {
  await act(async () => root.render(<App />));
  await act(async () => showTodos?.());
  const text = $("todo-row")?.querySelector("span");
  await act(async () => {
    text?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
  });
};

describe("App: to-do view", () => {
  it("opens the view, not the composer, on a double-click", async () => {
    await openView();
    expect($("todo-view")?.textContent).toContain("Fix the ring snap");
    expect($("todo-composer")).toBeNull();
  });

  it("swaps the view for the composer from Edit", async () => {
    await openView();
    await act(async () => button("Edit").click());
    await exitPlayed();
    expect($("todo-view")).toBeNull();
    expect(
      ($("todo-composer")?.querySelector("textarea") as HTMLTextAreaElement)
        .value,
    ).toBe("Fix the ring snap");
  });

  it("deletes the task from the view and closes it", async () => {
    await openView();
    await act(async () => button("Delete").click());
    await exitPlayed();
    expect(todoOp).toHaveBeenCalledWith({
      kind: "delete",
      line: LIST.todos[0].line,
      raw: LIST.todos[0].raw,
    });
    expect($("todo-view")).toBeNull();
  });
});
