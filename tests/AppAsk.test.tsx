// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/no-explicit-any */
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { defaultSettings } from "../src/shared/types";
import type { Workspace } from "../src/shared/types";

const nullComponent = vi.hoisted(() => ({ default: () => null }));
const captured = vi.hoisted(() => ({
  typed: null as ((key: string) => void) | null,
}));
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
  onTerminalExit: () => () => undefined,
  onTerminalTyped: (cb: (key: string) => void) => {
    captured.typed = cb;
    return () => undefined;
  },
}));
vi.mock("../src/renderer/preview/Preview", () => nullComponent);
vi.mock("../src/renderer/session/Timeline", () => nullComponent);
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
(HTMLCanvasElement.prototype as any).getContext = () => null;

let askListener: ((prompt: any) => void) | null = null;
let autoAnswerListener: ((on: boolean) => void) | null = null;
let toolListener: ((e: any) => void) | null = null;
let resolveWorkspaces: ((list: Workspace[]) => void) | null = null;

const ORCHESTRATOR: Workspace = {
  id: "ws-self",
  name: "Self",
  rootPath: "/self",
  kind: "vault",
  sourceId: "vault",
  isSelf: true,
};

let root: Root;
let container: HTMLDivElement;
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  askListener = null;
  autoAnswerListener = null;
  captured.typed = null;
  (window as any).jarvis = {
    getWorkspaces: () =>
      new Promise<Workspace[]>((resolve) => {
        resolveWorkspaces = resolve;
      }),
    getSettings: () => Promise.resolve(defaultSettings()),
    setSettings: () => Promise.resolve(),
    addProject: () => Promise.resolve([]),
    getGraph: () => Promise.resolve({ nodes: [], edges: [] }),
    getSymbolGraph: () => Promise.resolve({ nodes: [], edges: [] }),
    getCardSnapshots: () => Promise.resolve([]),
    ptyInput: () => Promise.resolve(true),
    onGraph: () => () => undefined,
    onToolEvent: (cb: (e: any) => void) => {
      toolListener = cb;
      return () => undefined;
    },
    onStatus: () => () => undefined,
    onSay: () => () => undefined,
    onAsk: (cb: (prompt: any) => void) => {
      askListener = cb;
      return () => {
        askListener = null;
      };
    },
    ttsVoices: () => Promise.resolve([]),
    ttsModels: () => Promise.resolve([]),
    listHeadModels: () => Promise.resolve([]),
    getNotesDir: () => Promise.resolve(null),
    pickNotesDir: () => Promise.resolve(null),
    clearNotesDir: () => Promise.resolve(null),
    getAutoAnswer: () => Promise.resolve(false),
    onAutoAnswer: (cb: (on: boolean) => void) => {
      autoAnswerListener = cb;
      return () => {
        autoAnswerListener = null;
      };
    },
    getTodos: () => Promise.resolve({ todos: [], malformed: [] }),
    todoOp: () => Promise.resolve({ ok: true }),
    onTodos: () => () => undefined,
    onShowTodos: () => () => undefined,
    onUserSubmitted: () => () => undefined,
    onPromptSubmitted: () => () => undefined,
  };
  container = document.createElement("div");
  document.body.appendChild(container);
  act(() => {
    root = createRoot(container);
  });
  await act(async () => {
    root.render(<App />);
  });
  await act(async () => {
    resolveWorkspaces!([ORCHESTRATOR]);
  });
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

const ask = (question: string, sessionKey = "ws-self", offered = false) => ({
  workspaceId: "ws-self",
  sessionKey,
  sessionId: `s-${sessionKey}`,
  ts: 1,
  ...(offered ? { offered: true as const } : {}),
  questions: [
    {
      question,
      header: "",
      multiSelect: false,
      options: [{ label: "Approve", description: "" }],
    },
  ],
});
const clear = (sessionKey = "ws-self") => ({
  ...ask("", sessionKey),
  questions: [],
});
const send = (p: any) => act(async () => askListener!(p));
const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
const shown = (q: string) => container.textContent?.includes(q) ?? false;

describe("App: an offered ask is held before it shows", () => {
  it("shows a plain ask at once", async () => {
    await send(ask("Plain?"));
    expect(shown("Plain?")).toBe(true);
  });

  it("holds an offered ask for 2000 ms", async () => {
    await send(ask("Held?", "ws-self", true));
    await advance(1999);
    expect(shown("Held?")).toBe(false);
    await advance(1);
    expect(shown("Held?")).toBe(true);
  });

  it("drops an offered ask that clears during the hold", async () => {
    await send(ask("Gone?", "ws-self", true));
    await advance(500);
    await send(clear());
    await advance(2000);
    expect(shown("Gone?")).toBe(false);
  });

  it("restarts the hold for a second offered ask", async () => {
    await send(ask("Again?", "ws-self", true));
    await advance(1500);
    await send(ask("Again?", "ws-self", true));
    await advance(1500);
    expect(shown("Again?")).toBe(false);
    await advance(500);
    expect(shown("Again?")).toBe(true);
  });

  it("drops an offered ask the user types over", async () => {
    await send(ask("Typed?", "ws-self", true));
    await advance(500);
    await act(async () => captured.typed!("ws-self"));
    await advance(2000);
    expect(shown("Typed?")).toBe(false);
  });

  it("drops an offered ask when a new prompt starts the turn", async () => {
    await send(ask("Prompted?", "ws-self", true));
    await advance(500);
    await act(async () =>
      toolListener!({
        sessionId: "s-ws-self",
        workspaceId: "ws-self",
        sessionKey: "ws-self",
        phase: "pre",
        tool: "Prompt",
        nodeIds: [],
        ts: 2,
      }),
    );
    await advance(2000);
    expect(shown("Prompted?")).toBe(false);
  });

  it("holds one session without delaying another", async () => {
    await send(ask("Alpha?", "ws-self", true));
    await send(ask("Beta?", "ws-self#1"));
    expect(shown("Beta?")).toBe(true);
    expect(shown("Alpha?")).toBe(false);
    await advance(2000);
    expect(shown("Alpha?")).toBe(true);
  });
});

describe("App: a plain-text question's reply", () => {
  const textAsk = (question: string) => ({
    ...ask(question),
    source: "text" as const,
    questions: [
      {
        question,
        header: "",
        multiSelect: false,
        options: [{ label: "Fast", description: "", reply: "1. Fast" }],
      },
    ],
  });
  const clickOption = async () => {
    await act(async () => {
      (
        container.querySelector('[data-testid="ask-option-0"]') as HTMLElement
      ).click();
    });
    await advance(200);
  };

  it("drops a text ask once its reply is sent", async () => {
    (window as any).jarvis.hasUnsentInput = () => Promise.resolve(false);
    await send(textAsk("Which?"));
    expect(shown("Which?")).toBe(true);
    await clickOption();
    expect(shown("Which?")).toBe(false);
  });

  it("keeps a text ask whose reply is refused for a draft", async () => {
    (window as any).jarvis.hasUnsentInput = () => Promise.resolve(true);
    await send(textAsk("Which?"));
    await clickOption();
    expect(shown("Which?")).toBe(true);
    expect(shown("clear the draft first")).toBe(true);
  });

  it("reports no terminal for a text reply that cannot be written", async () => {
    (window as any).jarvis.hasUnsentInput = () => Promise.resolve(false);
    (window as any).jarvis.ptyInput = () => Promise.resolve(false);
    await send(textAsk("Which?"));
    await clickOption();
    expect(shown("Which?")).toBe(true);
    expect(shown("no terminal is open for this session")).toBe(true);
  });
});

describe("App: the auto-answer button follows main", () => {
  it("turns to AUTO ON when main pushes true", async () => {
    expect(container.textContent).not.toContain("AUTO ON");
    await act(async () => autoAnswerListener!(true));
    expect(container.textContent).toContain("AUTO ON");
  });
});
