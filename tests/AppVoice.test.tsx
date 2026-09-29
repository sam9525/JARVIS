// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/no-explicit-any */
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { defaultSettings } from "../src/shared/types";
import type { Settings, Workspace, WorkspaceStatus } from "../src/shared/types";

// heavy visual children are stubs — this suite is about App's voice wiring,
// which lives entirely in App state + the real speak() calls it makes
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
  railSeats: () => 1, // App reads this for the boot hold, not for layout
}));
vi.mock("../src/renderer/terminal/TerminalPanel", () => ({
  ...nullComponent,
  onTerminalTyped: () => () => undefined,
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

// neither tracker is exercised by this suite — both resolve to a no-op stop
// fn so the effects that own them settle without ever calling back into App
vi.mock("../src/renderer/hands/hand-tracker", () => ({
  startHandTracker: () => Promise.resolve(() => undefined),
}));
vi.mock("../src/renderer/voice/voice-tracker", () => ({
  startVoiceTracker: () => Promise.resolve(() => undefined),
}));

// nextUtterance stays real (it's the thing under test, indirectly); speak
// and stopSpeaking are spied so the test can assert what almost got said
const speakSpy = vi.hoisted(() => vi.fn());
const stopSpeakingSpy = vi.hoisted(() => vi.fn());
vi.mock("../src/renderer/voice/speak", async () => {
  const actual = await vi.importActual<
    typeof import("../src/renderer/voice/speak")
  >("../src/renderer/voice/speak");
  return { ...actual, speak: speakSpy, stopSpeaking: stopSpeakingSpy };
});

import App from "../src/renderer/App";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let settingsOnDisk: Settings;
const setSettings = vi.fn(() => Promise.resolve());
let statusListener: ((s: WorkspaceStatus[]) => void) | null = null;
let sayListener: ((text: string) => void) | null = null;
let resolveWorkspaces: ((list: Workspace[]) => void) | null = null;

const ORCHESTRATOR: Workspace = {
  id: "ws-self",
  name: "Self",
  rootPath: "/self",
  kind: "vault",
  sourceId: "vault",
  isSelf: true,
};

// App renders the voice wave onto a canvas, and jsdom has no 2D backend —
// without this, every render logs "Not implemented: getContext". VoiceWave
// already treats a null context as "no wave to draw"; tests/voice/VoiceWave
// is where the drawing itself is checked.
(HTMLCanvasElement.prototype as any).getContext = () => null;

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  speakSpy.mockClear();
  stopSpeakingSpy.mockClear();
  setSettings.mockClear();
  statusListener = null;
  sayListener = null;
  resolveWorkspaces = null;
  settingsOnDisk = defaultSettings();
  (window as any).jarvis = {
    // controllable by the test: resolves only when the test calls it, so the
    // getWorkspaces/getSettings race can be driven in either order
    getWorkspaces: () =>
      new Promise<Workspace[]>((resolve) => {
        resolveWorkspaces = resolve;
      }),
    getSettings: () => Promise.resolve(settingsOnDisk),
    setSettings,
    addProject: () => Promise.resolve([]),
    getGraph: () => Promise.resolve({ nodes: [], edges: [] }),
    getSymbolGraph: () => Promise.resolve({ nodes: [], edges: [] }),
    ptyInput: () => Promise.resolve(true),
    onGraph: () => () => undefined,
    onToolEvent: () => () => undefined,
    onStatus: (cb: (s: WorkspaceStatus[]) => void) => {
      statusListener = cb;
      return () => undefined;
    },
    onSay: (cb: (text: string) => void) => {
      sayListener = cb;
      return () => {
        sayListener = null;
      };
    },
    ttsVoices: () => Promise.resolve([]),
    ttsModels: () => Promise.resolve([]),
    listHeadModels: () => Promise.resolve([]),
    getNotesDir: () => Promise.resolve(null),
    pickNotesDir: () => Promise.resolve(null),
    clearNotesDir: () => Promise.resolve(null),
    getTodos: () => Promise.resolve({ todos: [], malformed: [] }),
    todoOp: () => Promise.resolve({ ok: true }),
    onTodos: () => () => undefined,
    onShowTodos: () => () => undefined,
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

const flush = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
};
const mount = async () => {
  await act(async () => {
    root.render(<App />);
  });
  await flush();
};

describe("App: voice restored-message race", () => {
  // settings resolve (micOn -> true) before the orchestrator is known — the
  // ordering the bug report traced as the one that fails without the fix
  it("does not speak a restored message when settings resolve before workspaces", async () => {
    settingsOnDisk = { ...defaultSettings(), voiceControl: true };
    await mount(); // getSettings resolves during flush(); getWorkspaces is still pending

    // a restored inbox message is already sitting in `statuses` before the
    // orchestrator (workspaces) is known at all
    await act(async () => {
      statusListener!([
        {
          workspaceId: ORCHESTRATOR.id,
          kind: "idle",
          call: "",
          message: "restored old message",
          since: Date.now(),
          reads: 0,
          edits: 0,
        },
      ]);
    });

    // now the orchestrator becomes known
    await act(async () => {
      resolveWorkspaces!([ORCHESTRATOR]);
    });
    await flush();

    expect(speakSpy).not.toHaveBeenCalled();

    // a genuinely new message after the swallow must still be read aloud
    await act(async () => {
      statusListener!([
        {
          workspaceId: ORCHESTRATOR.id,
          kind: "idle",
          call: "",
          message: "fresh message",
          since: Date.now(),
          reads: 0,
          edits: 0,
        },
      ]);
    });
    await flush();

    expect(speakSpy).toHaveBeenCalledWith("fresh message");
  });

  // the opposite ordering, kept as a guard against a fix that only handles
  // one direction of the race
  it("does not speak a restored message when workspaces resolve before settings turn the mic on", async () => {
    settingsOnDisk = { ...defaultSettings(), voiceControl: true };
    await act(async () => {
      root.render(<App />);
    });
    // workspaces resolve first, before the settings promise (and therefore
    // micOn) has had a chance to
    await act(async () => {
      resolveWorkspaces!([ORCHESTRATOR]);
    });
    await act(async () => {
      statusListener!([
        {
          workspaceId: ORCHESTRATOR.id,
          kind: "idle",
          call: "",
          message: "restored old message",
          since: Date.now(),
          reads: 0,
          edits: 0,
        },
      ]);
    });
    await flush(); // settings resolve here, flipping micOn true

    expect(speakSpy).not.toHaveBeenCalled();
  });
  const push = (message: string, messageAt?: number) =>
    act(async () => {
      statusListener!([
        {
          workspaceId: ORCHESTRATOR.id,
          kind: "idle",
          call: "",
          message,
          messageAt,
          since: Date.now(),
          reads: 0,
          edits: 0,
        },
      ]);
    });

  // a fresh install has no jarvis-inbox.json, so the restored push carries no
  // message at all — the swallow must be spent on it, not held for the first
  // real reply of the session
  it("speaks the first live message when there was nothing to restore", async () => {
    settingsOnDisk = { ...defaultSettings(), voiceControl: true };
    await mount();
    await act(async () => {
      resolveWorkspaces!([ORCHESTRATOR]);
    });
    await flush();
    await push("");
    await flush();
    await push("first real reply");
    await flush();

    expect(speakSpy).toHaveBeenCalledWith("first real reply");
  });

  // jarvis_say speaks a delegate-finish summary directly; the orchestrator's
  // own Stop message then carries the identical text, and must not repeat it
  it("speaks a jarvis_say line and then skips the identical turn-end message", async () => {
    settingsOnDisk = { ...defaultSettings(), voiceControl: true };
    await mount();
    await act(async () => {
      resolveWorkspaces!([ORCHESTRATOR]);
    });
    await flush();
    await push(""); // spend the restore swallow so it can't mask the check below
    await flush();

    await act(async () => sayListener?.("build is green"));
    expect(speakSpy).toHaveBeenCalledWith("build is green");
    speakSpy.mockClear();

    // the same thought arriving as the orchestrator's own Stop message
    await push("build is green", 1000);
    await flush();
    expect(speakSpy).not.toHaveBeenCalled();

    // ...but the same words from the next turn are a new answer
    await push("build is green", 2000);
    await flush();
    expect(speakSpy).toHaveBeenCalledWith("build is green");
  });

  // "audio check" twice gets "all good" twice; each turn is heard
  it("speaks an identical reply once per turn", async () => {
    settingsOnDisk = { ...defaultSettings(), voiceControl: true };
    await mount();
    await act(async () => {
      resolveWorkspaces!([ORCHESTRATOR]);
    });
    await flush();
    await push(""); // spend the restore swallow
    await flush();

    await push("all good", 1000);
    await flush();
    await push("all good", 1000); // the same turn pushed again
    await flush();
    await push("all good", 2000);
    await flush();

    expect(speakSpy).toHaveBeenCalledTimes(2);
  });

  // an off switch that does not stay off is untrustworthy: jarvis_say must
  // not speak while voice control is switched off, even though the mouth and
  // ear are otherwise independent
  it("does not speak a jarvis_say line while voice control is off", async () => {
    settingsOnDisk = { ...defaultSettings(), voiceControl: false };
    await mount();
    await act(async () => {
      resolveWorkspaces!([ORCHESTRATOR]);
    });
    await flush();

    await act(async () => sayListener?.("build is green"));

    expect(speakSpy).not.toHaveBeenCalled();
  });

  // the head and wave are the voice made visible; a user who never turns the
  // mic on should not pay a GLB fetch, a pointer listener and a rAF loop
  it("draws no head or wave while voice control is off", async () => {
    settingsOnDisk = { ...defaultSettings(), voiceControl: false };
    await mount();
    await act(async () => {
      resolveWorkspaces!([ORCHESTRATOR]);
    });
    await flush();

    expect(container.querySelector('[data-testid="voice-wave"]')).toBeNull();
  });

  it("draws the head and wave once voice control is on", async () => {
    settingsOnDisk = { ...defaultSettings(), voiceControl: true };
    await mount();
    await act(async () => {
      resolveWorkspaces!([ORCHESTRATOR]);
    });
    await flush();

    expect(
      container.querySelector('[data-testid="voice-wave"]'),
    ).not.toBeNull();
  });

  // the mirror case: switched on, the same line is spoken
  it("speaks a jarvis_say line while voice control is on", async () => {
    settingsOnDisk = { ...defaultSettings(), voiceControl: true };
    await mount();
    await act(async () => {
      resolveWorkspaces!([ORCHESTRATOR]);
    });
    await flush();

    await act(async () => sayListener?.("build is green"));

    expect(speakSpy).toHaveBeenCalledWith("build is green");
  });
});

describe("App: a long message is spoken by its headline", () => {
  it("speaks the first paragraph once and does not repeat it", async () => {
    settingsOnDisk = { ...defaultSettings(), voiceControl: true };
    await mount();
    await act(async () => {
      resolveWorkspaces!([ORCHESTRATOR]);
    });
    await flush();

    const brief = "Three projects moved.\n\nJARVIS: shipped 0.4.4.";
    const push = async (message: string) => {
      await act(async () => {
        statusListener!([
          {
            workspaceId: ORCHESTRATOR.id,
            kind: "idle",
            call: "",
            message,
            since: Date.now(),
            reads: 0,
            edits: 0,
          },
        ]);
      });
      await flush();
    };

    await push(""); // spends the mic-on swallow on an empty row
    await push(brief);
    expect(speakSpy).toHaveBeenCalledWith("Three projects moved.");
    expect(speakSpy).toHaveBeenCalledTimes(1);

    await push(brief); // the same status pushed again must stay silent
    expect(speakSpy).toHaveBeenCalledTimes(1);
  });

  it("does not speak a restored long message, and swallows it by headline", async () => {
    settingsOnDisk = { ...defaultSettings(), voiceControl: true };
    await mount();
    const brief = "Three projects moved.\n\nJARVIS: shipped 0.4.4.";
    await act(async () => {
      statusListener!([
        {
          workspaceId: ORCHESTRATOR.id,
          kind: "idle",
          call: "",
          message: brief,
          since: Date.now(),
          reads: 0,
          edits: 0,
        },
      ]);
    });
    await act(async () => {
      resolveWorkspaces!([ORCHESTRATOR]);
    });
    await flush();
    expect(speakSpy).not.toHaveBeenCalled();
  });
});
