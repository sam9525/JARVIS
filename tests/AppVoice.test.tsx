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
// the graph and the rail record their last props, so a test can read the
// highlight store the graph is pointed at and open a workspace from the rail
const captured = vi.hoisted(() => ({
  graph: null as any,
  rail: null as any,
  typed: null as ((key: string) => void) | null,
  preview: null as any,
  cards: null as any,
  heard: null as ((u: { text: string }) => void) | null,
}));
vi.mock("../src/renderer/graph/Graph", () => ({
  default: (p: any) => {
    captured.graph = p;
    return null;
  },
  PAN_PX_PER_UNIT: 900,
}));
vi.mock("../src/renderer/graph/Graph3D", () => ({
  default: (p: any) => {
    captured.graph = p;
    return null;
  },
}));
vi.mock("../src/renderer/graph/FleetGraph", () => nullComponent);
vi.mock("../src/renderer/home/Ring", () => nullComponent);
vi.mock("../src/renderer/home/MissionControl", () => ({
  default: (p: any) => {
    captured.cards = p;
    return null;
  },
  DOT: {},
}));
vi.mock("../src/renderer/home/WorkspaceRail", () => ({
  default: (p: any) => {
    captured.rail = p;
    return null;
  },
  railSeats: () => 1, // App reads this for the boot hold, not for layout
}));
vi.mock("../src/renderer/terminal/TerminalPanel", () => ({
  ...nullComponent,
  onTerminalExit: () => () => undefined,
  onTerminalTyped: (cb: (key: string) => void) => {
    captured.typed = cb;
    return () => undefined;
  },
}));
vi.mock("../src/renderer/preview/Preview", () => ({
  default: (p: any) => {
    captured.preview = p;
    // a closed preview unmounts, which reads as no preview at all
    React.useEffect(
      () => () => {
        captured.preview = null;
      },
      [],
    );
    return null;
  },
}));
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
  startVoiceTracker: (onUtterance: (u: { text: string }) => void) => {
    captured.heard = onUtterance;
    return Promise.resolve(() => undefined);
  },
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
import { END_MS } from "../src/renderer/voice/use-voice-control";
import { getDraft, setDraft } from "../src/renderer/session-screen/drafts";
import { setViewMode } from "../src/renderer/session-screen/view-mode";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let settingsOnDisk: Settings;
const setSettings = vi.fn(() => Promise.resolve());
let statusListener: ((s: WorkspaceStatus[]) => void) | null = null;
let sayListener: ((text: string) => void) | null = null;
let askListener: ((prompt: any) => void) | null = null;
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
  askListener = null;
  toolListener = null;
  captured.graph = null;
  captured.rail = null;
  captured.typed = null;
  captured.preview = null;
  captured.cards = null;
  captured.heard = null;
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
    getCardSnapshots: () => Promise.resolve([]),
    ptyInput: () => Promise.resolve(true),
    onGraph: () => () => undefined,
    onToolEvent: (cb: (e: any) => void) => {
      toolListener = cb;
      return () => undefined;
    },
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
          sessions: [],
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
          sessions: [],
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
          sessions: [],
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
          sessions: [],
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

describe("App: a long message is spoken as a summary", () => {
  it("speaks the summary once and does not repeat it", async () => {
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
            sessions: [],
          },
        ]);
      });
      await flush();
    };

    await push(""); // spends the mic-on swallow on an empty row
    await push(brief);
    expect(speakSpy).toHaveBeenCalledWith(
      "Three projects moved. JARVIS: shipped 0.4.4.",
    );
    expect(speakSpy).toHaveBeenCalledTimes(1);

    await push(brief); // the same status pushed again must stay silent
    expect(speakSpy).toHaveBeenCalledTimes(1);
  });

  it("does not speak a restored long message, and swallows it by summary", async () => {
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
          sessions: [],
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

describe("App: a main-agent question is spoken", () => {
  it("speaks each question panel once, and the same question again when re-asked", async () => {
    settingsOnDisk = { ...defaultSettings(), voiceControl: true };
    await mount();
    await act(async () => resolveWorkspaces!([ORCHESTRATOR]));
    await flush();
    await act(async () => {
      statusListener!([
        {
          workspaceId: ORCHESTRATOR.id,
          kind: "idle",
          call: "",
          message: "",
          since: Date.now(),
          reads: 0,
          edits: 0,
          sessions: [],
        },
      ]);
    }); // spend the restore swallow
    const ask = (ts: number) => ({
      workspaceId: "ws-self",
      sessionKey: "ws-self",
      sessionId: "s1",
      ts,
      questions: [
        {
          question: "Approve?",
          header: "Spec",
          multiSelect: false,
          options: [
            { label: "Approve", description: "" },
            { label: "Review in browser", description: "" },
          ],
        },
      ],
    });
    const line = "Self asks: Approve?. Options: Approve, Review in browser.";
    await act(async () => askListener!(ask(1)));
    await flush();
    expect(speakSpy).toHaveBeenCalledWith(line);
    speakSpy.mockClear();
    await act(async () => askListener!({ ...ask(1), questions: [] })); // answered
    await act(async () => askListener!(ask(2))); // re-asked, same words
    await flush();
    expect(speakSpy).toHaveBeenCalledTimes(1);
    expect(speakSpy).toHaveBeenCalledWith(line);
  });

  it("does not repeat an open question when the panel re-renders", async () => {
    settingsOnDisk = { ...defaultSettings(), voiceControl: true };
    await mount();
    await act(async () => resolveWorkspaces!([ORCHESTRATOR]));
    await flush();
    const row = (message: string, messageAt: number) => ({
      workspaceId: ORCHESTRATOR.id,
      kind: "idle" as const,
      call: "",
      message,
      messageAt,
      since: Date.now(),
      reads: 0,
      edits: 0,
      sessions: [],
    });
    await act(async () => statusListener!([row("", 0)])); // spend the restore swallow
    const open = {
      workspaceId: "ws-self",
      sessionKey: "ws-self",
      sessionId: "s1",
      ts: 1,
      questions: [
        {
          question: "Approve?",
          header: "Spec",
          multiSelect: false,
          options: [{ label: "Approve", description: "" }],
        },
      ],
    };
    const line = "Self asks: Approve?. Options: Approve.";
    await act(async () => askListener!(open));
    await flush();
    expect(speakSpy).toHaveBeenCalledWith(line);
    speakSpy.mockClear();
    await act(async () => askListener!(open));
    await act(async () => statusListener!([row("working on it", 5)]));
    await flush();
    expect(speakSpy).not.toHaveBeenCalledWith(line);
  });
});

const REPO: Workspace = {
  id: "d:/r",
  name: "Repo",
  rootPath: "d:/r",
  kind: "code",
  sourceId: "gitnexus",
};
const sessionRow = (key: string, label: string) => ({
  key,
  label,
  kind: "idle" as const,
  live: true,
  call: "",
  since: 0,
  worktree: true,
});
const repoRow = {
  workspaceId: REPO.id,
  kind: "idle" as const,
  call: "",
  since: 0,
  reads: 0,
  edits: 0,
  sessions: [sessionRow("d:/r", "main"), sessionRow("d:/r#1", "1")],
};

describe("App: questions are kept per session", () => {
  it("does not speak a project session's question; the main agent's still is", async () => {
    settingsOnDisk = { ...defaultSettings(), voiceControl: true };
    await mount();
    await act(async () => resolveWorkspaces!([ORCHESTRATOR, REPO]));
    await flush();
    await act(async () =>
      statusListener!([
        {
          workspaceId: ORCHESTRATOR.id,
          kind: "idle",
          call: "",
          message: "",
          since: Date.now(),
          reads: 0,
          edits: 0,
          sessions: [],
        },
        repoRow,
      ]),
    ); // spend the restore swallow
    const ask = (workspaceId: string, sessionKey: string, ts: number) => ({
      workspaceId,
      sessionKey,
      sessionId: `s-${sessionKey}`,
      ts,
      questions: [
        {
          question: "Approve?",
          header: "",
          multiSelect: false,
          options: [{ label: "Approve", description: "" }],
        },
      ],
    });
    await act(async () => askListener!(ask("d:/r", "d:/r#1", 1)));
    await flush();
    expect(speakSpy).not.toHaveBeenCalled();
    await act(async () => askListener!(ask("ws-self", "ws-self", 2)));
    await flush();
    expect(speakSpy).toHaveBeenCalledWith(
      "Self asks: Approve?. Options: Approve.",
    );
  });
});

describe("App: the graph shows the selected tab's highlights", () => {
  it("lights a #1 read only once tab 1 is selected", async () => {
    await mount();
    await act(async () => resolveWorkspaces!([ORCHESTRATOR, REPO]));
    await flush();
    await act(async () => statusListener!([repoRow]));
    await act(async () => captured.rail.onSelect(REPO));
    await flush();
    await act(async () =>
      toolListener!({
        sessionId: "s1",
        workspaceId: "d:/r",
        sessionKey: "d:/r#1",
        phase: "pre",
        tool: "Read",
        nodeIds: ["src/a.ts"],
        ts: 1,
      }),
    );
    const lit = () =>
      captured.graph.stateRef.current.nodes.has("src/a.ts") as boolean;
    expect(lit()).toBe(false);
    const tab = container.querySelector('[data-tab="d:/r#1"]');
    expect(tab).not.toBeNull();
    await act(async () =>
      (tab!.closest("button") as HTMLButtonElement).click(),
    );
    await flush();
    expect(lit()).toBe(true);
  });
});

describe("App: a session's own activity clears its question", () => {
  const ask = (sessionKey: string, question: string) => ({
    workspaceId: "d:/r",
    sessionKey,
    sessionId: `s-${sessionKey}`,
    ts: 1,
    questions: [
      {
        question,
        header: "",
        multiSelect: false,
        options: [{ label: "Yes", description: "" }],
      },
    ],
  });
  const shownQuestion = () =>
    container.querySelector('[data-testid="ask-question"]')?.textContent ??
    null;
  const openRepo = async () => {
    await mount();
    await act(async () => resolveWorkspaces!([ORCHESTRATOR, REPO]));
    await flush();
    await act(async () => statusListener!([repoRow]));
    await act(async () => captured.rail.onSelect(REPO));
    await flush();
  };

  it("typing in #1's terminal clears #1's question, not main's", async () => {
    await openRepo();
    await act(async () => askListener!(ask("d:/r", "Main?")));
    await act(async () => askListener!(ask("d:/r#1", "One?")));
    expect(shownQuestion()).toBe("Main?");
    await act(async () => captured.typed!("d:/r"));
    // main's is gone, so the fleet's other open question shows
    expect(shownQuestion()).toBe("One?");
    await act(async () => captured.typed!("d:/r#1"));
    expect(shownQuestion()).toBeNull();
  });

  it("a Prompt event clears only its own session's question", async () => {
    await openRepo();
    await act(async () => askListener!(ask("d:/r#1", "One?")));
    await act(async () =>
      toolListener!({
        sessionId: "s-main",
        workspaceId: "d:/r",
        sessionKey: "d:/r",
        phase: "pre",
        tool: "Prompt",
        nodeIds: [],
        ts: 2,
      }),
    );
    expect(shownQuestion()).toBe("One?");
    await act(async () =>
      toolListener!({
        sessionId: "s-d:/r#1",
        workspaceId: "d:/r",
        sessionKey: "d:/r#1",
        phase: "pre",
        tool: "Prompt",
        nodeIds: [],
        ts: 3,
      }),
    );
    expect(shownQuestion()).toBeNull();
  });
});

describe("App: the preview across sessions", () => {
  const openRepo = async () => {
    await mount();
    await act(async () => resolveWorkspaces!([ORCHESTRATOR, REPO]));
    await flush();
    await act(async () => statusListener!([repoRow]));
    await act(async () => captured.rail.onSelect(REPO));
    await flush();
  };
  const event = (sessionKey: string, over: any) => ({
    sessionId: `s-${sessionKey}`,
    workspaceId: "d:/r",
    sessionKey,
    nodeIds: [],
    ts: 1,
    ...over,
  });

  it("refreshes the open preview when a sibling session edits the file", async () => {
    await openRepo();
    await act(async () => captured.graph.onNodeClick("src/a.ts"));
    const before = captured.preview.revision as number;
    await act(async () =>
      toolListener!(
        event("d:/r#1", { phase: "post", tool: "Edit", nodeIds: ["src/a.ts"] }),
      ),
    );
    expect(captured.preview.revision).toBe(before + 1);
  });

  describe("an approved document", () => {
    const SPEC = "docs/superpowers/specs/a.md";
    // the fixture sessions run in worktrees, so the preview id carries the prefix
    const SPEC_PREVIEW = `.worktrees/main/${SPEC}`;
    const specAsk = {
      workspaceId: "d:/r",
      sessionKey: "d:/r",
      sessionId: "s-d:/r",
      ts: 5,
      questions: [
        {
          question: "Approve the spec?",
          header: "Spec",
          multiSelect: false,
          options: [
            { label: "Approve", description: "" },
            { label: "Review in browser", description: "" },
          ],
        },
      ],
    };
    const openSpecPreview = async () => {
      await openRepo();
      await act(async () =>
        toolListener!(
          event("d:/r", { phase: "post", tool: "Write", nodeIds: [SPEC] }),
        ),
      );
      await act(async () => askListener!(specAsk));
      const open = container.querySelector('[data-testid="ask-doc"]');
      await act(async () => (open as HTMLButtonElement).click());
      expect(captured.preview?.nodeId).toBe(SPEC_PREVIEW);
    };
    const answered = (label: string) => ({
      ...specAsk,
      questions: [],
      answers: [{ header: "Spec", label }],
    });

    it("closes the spec preview when the spec is approved", async () => {
      await openSpecPreview();
      await act(async () => askListener!(answered("Approve")));
      expect(captured.preview).toBeNull();
    });

    it("keeps the spec preview on Review in browser", async () => {
      await openSpecPreview();
      await act(async () => askListener!(answered("Review in browser")));
      expect(captured.preview?.nodeId).toBe(SPEC_PREVIEW);
    });
  });

  describe("a pending open", () => {
    afterEach(() => vi.useRealTimers());
    const readThenWait = async (switchTab: boolean) => {
      await openRepo();
      vi.useFakeTimers();
      await act(async () =>
        toolListener!(
          event("d:/r", { phase: "pre", tool: "Read", nodeIds: ["src/a.ts"] }),
        ),
      );
      if (switchTab) {
        const tab = container.querySelector('[data-tab="d:/r#1"]');
        await act(async () =>
          (tab!.closest("button") as HTMLButtonElement).click(),
        );
      }
      await act(async () => {
        vi.advanceTimersByTime(5000);
      });
    };

    it("opens once reads go quiet", async () => {
      await readThenWait(false);
      expect(captured.preview?.nodeId).toBe("src/a.ts");
    });

    it("dies on a tab switch", async () => {
      await readThenWait(true);
      expect(captured.preview).toBeNull();
    });
  });
});

describe("App: a card with no selected tab", () => {
  it("shows its most urgent session's highlights", async () => {
    await mount();
    await act(async () => resolveWorkspaces!([ORCHESTRATOR, REPO]));
    await flush();
    await act(async () =>
      statusListener!([
        {
          ...repoRow,
          sessions: [
            sessionRow("d:/r", "main"),
            { ...sessionRow("d:/r#1", "1"), kind: "working" as const },
          ],
        },
      ]),
    );
    await act(async () =>
      toolListener!({
        sessionId: "s1",
        workspaceId: "d:/r",
        sessionKey: "d:/r#1",
        phase: "pre",
        tool: "Read",
        nodeIds: ["src/a.ts"],
        ts: 1,
      }),
    );
    expect(captured.cards.getStore("d:/r").nodes.has("src/a.ts")).toBe(true);
  });
});

describe("App: dictation goes where the session is shown", () => {
  const ptyInput = vi.fn((_key: string, _data: string) =>
    Promise.resolve(true),
  );

  beforeEach(() => {
    ptyInput.mockClear();
    (window as any).jarvis.ptyInput = ptyInput;
    setDraft(ORCHESTRATOR.id, "");
    setViewMode(ORCHESTRATOR.id, "screen");
  });

  const dictate = async (text: string) => {
    settingsOnDisk = { ...defaultSettings(), voiceControl: true };
    await mount();
    await act(async () => {
      resolveWorkspaces!([ORCHESTRATOR]);
    });
    await flush();
    await hear(text);
  };
  // one utterance, then the silence that closes the dictation
  const hear = async (text: string) => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      act(() => captured.heard!({ text }));
      act(() => {
        vi.advanceTimersByTime(END_MS);
      });
    } finally {
      vi.useRealTimers();
    }
    await flush();
  };
  const dictated = () =>
    ptyInput.mock.calls.filter(([, data]) => data.includes("open the notes"));

  it("dictation fills the draft in screen mode", async () => {
    await dictate("Jarvis, open the notes");
    expect(getDraft(ORCHESTRATOR.id)).toBe("open the notes");
    expect(dictated()).toEqual([]);
  });

  it("dictation writes to the PTY in raw mode", async () => {
    setViewMode(ORCHESTRATOR.id, "raw");
    await dictate("Jarvis, open the notes");
    expect(dictated()).toEqual([[ORCHESTRATOR.id, "open the notes"]]);
    expect(getDraft(ORCHESTRATOR.id)).toBe("");
  });

  it("dictation never writes a carriage return", async () => {
    setViewMode(ORCHESTRATOR.id, "raw");
    await dictate("Jarvis, open the notes");
    setViewMode(ORCHESTRATOR.id, "screen");
    await hear("Jarvis, open the notes again");
    expect(getDraft(ORCHESTRATOR.id)).toBe("open the notes again");
    expect(ptyInput.mock.calls.some(([, data]) => data.includes("\r"))).toBe(
      false,
    );
    expect(getDraft(ORCHESTRATOR.id)).not.toContain("\r");
  });
});
