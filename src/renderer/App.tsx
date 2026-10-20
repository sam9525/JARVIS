import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Graph from "./graph/Graph";
import Graph3D from "./graph/Graph3D";
import GraphSlot from "./graph/GraphSlot";
import Preview from "./preview/Preview";
import GraphSettingsPanel from "./ui/GraphSettingsPanel";
import AskPanel, { pickAsk } from "./ui/AskPanel";
import type { AskPrompt } from "../main/ask-mapper";
import MouthPicker from "./voice/MouthPicker";
import WorkspaceRail, { railSeats } from "./home/WorkspaceRail";
import MissionControl from "./home/MissionControl";
import HomeHeader from "./home/HomeHeader";
import TerminalPanel, { onTerminalTyped } from "./terminal/TerminalPanel";
import FleetGraph from "./graph/FleetGraph";
import Ring from "./home/Ring";
import Segmented from "./ui/Segmented";
import EmptyGraph from "./graph/EmptyGraph";
import Timeline from "./session/Timeline";
import Bezel from "./ui/Bezel";
// One source of truth for the version string: the title was a literal and had
// already drifted two releases behind the manifest.
import { version as appVersion } from "../../package.json";
import VoiceWave from "./voice/VoiceWave";
import type { RigKind } from "./voice/head-rig";
import Panel from "./ui/Panel";
import TodoPanel from "./todos/TodoPanel";
import TodoComposer, { type ComposeRequest } from "./todos/TodoComposer";
import TodoToggle from "./todos/TodoToggle";
import TodoView from "./todos/TodoView";
import { ENTER_MS, runMs, useBootStage } from "./ui/boot-stage";
import {
  ASK_Z,
  SETTINGS_Z,
  besideTodos,
  centredView,
  clampToViewport,
  defaultPanel,
  grabTarget,
  movePanel,
  raise,
  rescaleAll,
  snapToEdges,
  Z_BASE,
} from "./ui/panel-layout";
import { BTN_IDLE, TOP_ROW } from "./ui/hud";
import { appendEvent, foldTo, nextRev } from "./session/replay";
import {
  applyEvent,
  emptyState,
  resetHighlights,
  type HighlightState,
} from "./session/highlight-store";
import { filterGraph } from "./graph/graph-filter";
import { useWorkspaceGraphs } from "./graph/use-workspace-graphs";
import { domainsOf } from "./graph/domain-colors";
import { seedGroups } from "./graph/seed-groups";
import { defaultSettings, groupsFor } from "../shared/types";
import {
  RECENT_PICKS,
  hueOfWorkspace,
  hueToHex,
} from "./graph/workspace-color";
import { createPreviewOpener, isEditOf } from "./preview/preview-opener";
import type {
  CodeGraphLevel,
  HomeView,
  PanelId,
  PanelMap,
  PanelState,
  Settings,
  Todo,
  TodoList,
  TodoOp,
  TodoOpResult,
  ToolEvent,
  VaultGraph,
  Workspace,
  WorkspaceStatus,
} from "../shared/types";
import { buildWikilinkResolver } from "../shared/wikilink";
import HandToggle from "./hands/HandToggle";
import HandCursor, { type HandCursorHandle } from "./hands/HandCursor";
import { useHandControl } from "./hands/use-hand-control";
import { useHandActions, type HandActions } from "./hands/use-hand-actions";
import { useVoiceControl } from "./voice/use-voice-control";
import { nextUtterance, speak, stopSpeaking, type Spoken } from "./voice/speak";
import VoiceToggle from "./voice/VoiceToggle";
import type { Graph3DHandle } from "./graph/Graph3D";
import type { GraphHandle } from "./graph/Graph";

const HOME_VIEW_OPTIONS: { value: HomeView; label: string }[] = [
  { value: "cards", label: "Cards" },
  { value: "ring", label: "Ring" },
  { value: "fleet", label: "Fleet" },
];

// vault workspaces have no symbol graph, so this toggle is code-only
const GRAPH_LEVEL_OPTIONS: { value: CodeGraphLevel; label: string }[] = [
  { value: "file", label: "Files" },
  { value: "symbol", label: "Symbols" },
];

// the same box on the home screen and in a workspace
const SHARED_PANELS = new Set<PanelId>(["todos", "compose", "view", "ask"]);

const fold = (m: PanelMap): PanelMap =>
  m.terminal ? { ...m, terminal: { ...m.terminal, collapsed: true } } : m;

/** absent entries fall back to defaultPanel, which already folds the terminal */
// Which head a marked mouth belongs to. The built-in helmet has no name of its
// own, so it needs a stand-in — spelt once, because the picker and the wave
// have to agree on it or a marked mouth is stored where nothing reads it.
const headKey = (s: Settings) => s.headModel ?? "__builtin";
// A marked mouth is the consent: the switch is disabled until a head has one,
// so nobody can turn it on beforehand, and a mouth marked by hand that then
// sits shut reads as broken. An explicit false still wins — it is how you
// silence it. Computed here once, because the settings panel draws the same
// switch and `rigKind` is null until a head has loaded.
const mouthOn = (s: Settings) =>
  s.headMouth ?? Boolean(s.headMouths?.[headKey(s)]);

const withFoldedTerminal = (s: Settings): Settings => ({
  ...s,
  panels: { home: fold(s.panels.home), workspace: fold(s.panels.workspace) },
});

export default function App() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [active, setActive] = useState<Workspace | null>(null);
  const [statuses, setStatuses] = useState<WorkspaceStatus[]>([]);
  const [previewNode, setPreviewNode] = useState<string | null>(null);
  const [settings, setSettings] = useState<Settings>(defaultSettings());
  // Mirrors `settings` synchronously (updated every render, below) so the
  // debounced disk-write timer in `setPanel` always captures the latest
  // value instead of whatever was current when the timer was armed (I4).
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  // Graphs mount only after settings load: swapping the forces/display prop
  // identities while react-force-graph-3d's first async graphData flush is
  // still pending reheats an engine whose layout doesn't exist yet — the
  // animation loop throws and dies, leaving a permanent black screen.
  const [settingsReady, setSettingsReady] = useState(false);
  const [search, setSearch] = useState(""); // transient — cleared on restart
  const [showSettings, setShowSettings] = useState(false);
  const [showTodos, setShowTodos] = useState(false);
  const [todoList, setTodoList] = useState<TodoList>({
    todos: [],
    malformed: [],
  });
  const [showMouthPicker, setShowMouthPicker] = useState(false);
  const [showHome, setShowHome] = useState(true); // open on the command center
  const [homeView, setHomeView] = useState<HomeView>("cards");
  const [ringCentreId, setRingCentreId] = useState<string | null>(null);
  // MissionControl is hook-free so it stays testable without a DOM — the
  // clock that keeps its "40s ago" honest therefore lives here.
  const [cardNow, setCardNow] = useState(() => Date.now());
  // the open question per workspace. Not a queue: the panel shows the active
  // workspace's question, and another workspace asking shows up as its rail
  // pip going amber.
  const [asks, setAsks] = useState<Map<string, AskPrompt>>(new Map());
  // An answer is two writes 80 ms apart and the panel moves to the next
  // question at once, so a second click would otherwise put its arrows in
  // front of the first answer's Enter. Every answer queues behind the last.
  const askWriteRef = useRef(Promise.resolve());

  const [focusedPanel, setFocusedPanel] = useState<PanelId>("terminal");
  // `open` is kept apart from the request so the panel's exit still has a
  // request to draw while it plays; `seq` remounts the composer per opening
  const [compose, setCompose] = useState<{
    open: boolean;
    request: ComposeRequest;
    seq: number;
  }>({ open: false, request: { mode: "add" }, seq: 0 });
  // kept after close for the same reason as `compose.request`
  const [taskView, setTaskView] = useState<{
    open: boolean;
    todo: Todo | null;
    project: string;
    seq: number;
  }>({ open: false, todo: null, project: "", seq: 0 });
  const [deckCleared, setDeckCleared] = useState(false);
  // fallbacks are not defensive padding: tests/App.test.tsx stubs `window` as
  // `{ jarvis: {} }`, so an unguarded read here yields NaN geometry rather
  // than a visible failure
  const [viewport, setViewport] = useState(() => ({
    width: window.innerWidth || 1280,
    height: window.innerHeight || 800,
  }));

  useEffect(() => {
    const onResize = () =>
      setViewport({
        width: window.innerWidth || 1280,
        height: window.innerHeight || 800,
      });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const layoutId = showHome ? "home" : "workspace";
  const panels: PanelMap = settings.panels[layoutId];

  // One box on both screens for these, read from the home map. Only the
  // geometry is shared: z stays per layout, since `raise` renormalises a
  // whole map and a z copied across would tie with its neighbours there.
  const panelState = (id: PanelId): PanelState => {
    const own = panels[id] ?? defaultPanel(id, viewport);
    const home = SHARED_PANELS.has(id) ? settings.panels.home[id] : undefined;
    return home ? { ...home, z: own.z } : own;
  };

  // Debounced: a drag would otherwise rewrite jarvis-settings.json once per
  // frame. Renderer state updates immediately; only the disk write waits.
  // Scheduling lives here, not inside the `setSettings` updater — updaters
  // must be pure, and React 18 StrictMode runs them twice.
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Takes a patch of the layout's map, not one panel: `raise` renormalises
  // every z at once, and persisting only the focused one leaves the rest on
  // their old values until two tie — after which `raise` short-circuits on
  // `target.z === top` and focus stops reordering anything, permanently.
  const setPanels = useCallback(
    (patch: PanelMap) => {
      setSettings((s) => {
        const otherId = layoutId === "home" ? "workspace" : "home";
        const other = { ...s.panels[otherId] };
        for (const [id, p] of Object.entries(patch) as Array<
          [PanelId, PanelState]
        >)
          if (SHARED_PANELS.has(id))
            // first arrival on the other screen goes on top of its stack: this
            // screen's z can tie a panel there, and a tie stalls `raise`
            other[id] = {
              ...p,
              z:
                other[id]?.z ??
                Math.max(Z_BASE - 1, ...Object.values(other).map((q) => q.z)) +
                  1,
            };
        return {
          ...s,
          panels: {
            ...s.panels,
            [layoutId]: { ...s.panels[layoutId], ...patch },
            [otherId]: other,
          },
        };
      });
      if (saveTimer.current) clearTimeout(saveTimer.current);
      // reads settingsRef at fire time, not whatever was current when the
      // timer was armed — an `updateSettings` write in between must not be
      // clobbered by a stale snapshot (I4)
      saveTimer.current = setTimeout(() => {
        saveTimer.current = null;
        window.jarvis.setSettings(settingsRef.current).catch(console.error);
      }, 400);
    },
    [layoutId],
  );
  const setPanel = useCallback(
    (id: PanelId, next: PanelState) => setPanels({ [id]: next }),
    [setPanels],
  );

  // Panels ride the window: maximizing, restoring or reopening at a different
  // size rescales them, and a layout saved on a bigger monitor is pulled back
  // on screen by the clamp inside.
  //
  // The reference is `panelViewport` — the window the geometry was written in —
  // not the previous render's size. That makes the rescale idempotent (a
  // second run finds from === to), so StrictMode's double-invoke and a reopen
  // at the same size both leave every width exactly as it was saved.
  useEffect(() => {
    if (!settingsReady) return;
    setSettings((s) => {
      const from = s.panelViewport ?? viewport;
      return {
        ...s,
        panelViewport: viewport,
        panels: {
          home: rescaleAll(s.panels.home, from, viewport),
          workspace: rescaleAll(s.panels.workspace, from, viewport),
        },
      };
    });
  }, [settingsReady, viewport]);

  const focusPanel = useCallback(
    (id: PanelId) => {
      setFocusedPanel(id);
      setPanels(raise({ ...panels, [id]: panelState(id) }, id));
    },
    [panels, setPanels],
  );

  // an edit whose task left the file (or moved line) stays open with its
  // draft; the store refuses the save as stale rather than overwrite the line
  const editTarget =
    compose.request.mode === "edit" ? compose.request.todo : null;
  const composeShown = showTodos && compose.open;
  const openCompose = (request: ComposeRequest) => {
    setCompose((c) => ({ open: true, request, seq: c.seq + 1 }));
    setFocusedPanel("compose");
    // placed beside the list only when it opens: a composer already out
    // stays wherever it was moved to
    const at = composeShown
      ? panelState("compose")
      : besideTodos(panelState("todos"), viewport);
    setPanels(raise({ ...panels, compose: at }, "compose"));
  };
  const closeCompose = () => setCompose((c) => ({ ...c, open: false }));
  const viewShown = showTodos && taskView.open;
  // re-centred on every opening, unlike the composer: a view is a glance
  const openView = (todo: Todo, project: string) => {
    setTaskView((v) => ({ open: true, todo, project, seq: v.seq + 1 }));
    setFocusedPanel("view");
    setPanels(
      raise(
        { ...panels, view: centredView(panelState("todos"), viewport) },
        "view",
      ),
    );
  };
  const closeView = () => setTaskView((v) => ({ ...v, open: false }));
  // closing the list takes its composer and view with it, and reopening it
  // does not bring an old draft back
  useEffect(() => {
    if (showTodos) return;
    setCompose((c) => (c.open ? { ...c, open: false } : c));
    setTaskView((v) => (v.open ? { ...v, open: false } : v));
  }, [showTodos]);

  // jarvis_todos arrives as a push, long after this effect ran; the ref keeps
  // the raise working against the panels map of that moment, not of mount
  const focusPanelRef = useRef(focusPanel);
  focusPanelRef.current = focusPanel;
  useEffect(() => {
    window.jarvis.getTodos().then(setTodoList).catch(console.error);
    const offList = window.jarvis.onTodos(setTodoList);
    // the agent says the list is open, so a cleared deck must not hide it
    const offShow = window.jarvis.onShowTodos(() => {
      setDeckCleared(false);
      setShowTodos(true);
      focusPanelRef.current("todos");
    });
    return () => {
      offList();
      offShow();
    };
  }, []);

  // a refused op means the panel was looking at an old file: reload it
  const onTodoOp = useCallback(async (op: TodoOp): Promise<TodoOpResult> => {
    const r = await window.jarvis
      .todoOp(op)
      .catch((e: unknown): TodoOpResult => ({ ok: false, error: String(e) }));
    if (!r.ok) window.jarvis.getTodos().then(setTodoList).catch(console.error);
    return r;
  }, []);

  const growTodos = useCallback(
    (px: number) => {
      const s = panelState("todos");
      const next = clampToViewport({ ...s, h: s.h + px }, viewport);
      // at full height the list still overflows; writing an unchanged box
      // would re-render, re-measure and write again forever
      if (next.h !== s.h) setPanel("todos", next);
    },
    [panels, settings.panels.home, viewport, setPanel],
  );

  const todoProjects = useMemo(
    () => workspaces.filter((w) => !w.isSelf).map((w) => w.name),
    [workspaces],
  );

  // one highlight store per workspace; Graph reads stateRef.current per frame,
  // so retargeting .current on switch is all a switch needs
  const storesRef = useRef(new Map<string, HighlightState>());
  const stateRef = useRef(emptyState());
  const activeIdRef = useRef<string | null>(null);
  // whichever graph view is mounted registers its gesture map here
  const handActionsRef = useRef<HandActions>({});

  const graphs = useWorkspaceGraphs({
    active,
    activeIdRef,
    codeGraphLevel: settings.codeGraphLevel,
    workspaces,
    showHome,
    onWorkspacesChanged: setWorkspaces,
  });
  const { graph, graphLoading, cardGraphs, cardsLoaded, indexing } = graphs;

  // event log per workspace, feeding the replay scrubber. logRev exists only to
  // re-render the bar as events arrive — the log itself stays in a ref so an
  // append is O(1) rather than an array copy per event.
  const logsRef = useRef(new Map<string, ToolEvent[]>());
  const [replayIndex, setReplayIndex] = useState<number | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [_logRev, setLogRev] = useState(0);

  const storeFor = (id: string): HighlightState => {
    let s = storesRef.current.get(id);
    if (!s) {
      s = emptyState();
      storesRef.current.set(id, s);
    }
    return s;
  };

  // Replay is a retarget of the same ref workspace switching retargets. The
  // live store keeps receiving events while parked, so returning to live needs
  // no catch-up — only a fresh rev so Graph3D re-bakes against the new object.
  const onScrub = useCallback((i: number | null) => {
    const id = activeIdRef.current;
    if (!id) return;
    setReplayIndex(i);
    if (i === null) {
      const live = storeFor(id);
      live.rev = nextRev();
      stateRef.current = live;
    } else {
      stateRef.current = foldTo(logsRef.current.get(id) ?? [], i);
    }
  }, []);

  // debounced auto-open: last-read file after reads go quiet
  const onPreviewEvent = useMemo(() => createPreviewOpener(setPreviewNode), []);
  // read by the event subscription, which is set up once and would otherwise
  // see only the first render's previewNode
  const previewNodeRef = useRef(previewNode);
  previewNodeRef.current = previewNode;
  const [previewRev, setPreviewRev] = useState(0);

  const openWorkspace = useCallback(
    (ws: Workspace) => {
      onPreviewEvent.cancel(); // pending open from the old workspace must die
      setPreviewNode(null);
      setActive(ws);
      activeIdRef.current = ws.id;
      stateRef.current = storeFor(ws.id);
      setReplayIndex(null); // the ref above already points at the live store
      // a mid-drag switch must not latch across workspaces (ledger #11)
      grabbedRef.current = undefined;
    },
    [onPreviewEvent],
  );

  useEffect(() => {
    const offs: Array<() => void> = [];
    let cancelled = false;
    window.jarvis.getWorkspaces().then((list) => {
      if (cancelled) return;
      setWorkspaces(list);
      if (list.length === 0) return;
      openWorkspace(list[0]); // vault first
      const vaultId = list[0].id;
      // watcher only feeds the vault — cache under its id, show if on screen
      offs.push(
        window.jarvis.onGraph((g) => graphs.applyWatchedGraph(vaultId, g)),
      );
    });
    window.jarvis
      .getSettings()
      // the terminal always opens folded, whatever it was left at — you land
      // on the graph, and unfolding it is one click
      .then((s) => setSettings(withFoldedTerminal(s)))
      .catch(console.error)
      .finally(() => setSettingsReady(true)); // defaults still render on failure
    offs.push(
      window.jarvis.onToolEvent((e) => {
        // a new turn started, so whatever the question was, it is over. This
        // is also the backstop for a session still running the old matcher.
        if (e.tool === "Prompt")
          setAsks((prev) => {
            if (!prev.has(e.workspaceId)) return prev;
            const next = new Map(prev);
            next.delete(e.workspaceId);
            return next;
          });
        const fresh = appendEvent(logsRef.current, e);
        applyEvent(storeFor(e.workspaceId), e, performance.now());
        if (e.workspaceId === activeIdRef.current) {
          if (fresh) onScrub(null); // the past being replayed no longer exists
          setLogRev((n) => n + 1);
          onPreviewEvent(e);
          if (isEditOf(e, previewNodeRef.current)) setPreviewRev((n) => n + 1);
        }
      }),
    );
    offs.push(window.jarvis.onStatus(setStatuses));
    // typing into the session means the answer is being given there
    offs.push(
      onTerminalTyped((id) =>
        setAsks((prev) => {
          if (!prev.has(id)) return prev;
          const next = new Map(prev);
          next.delete(id);
          return next;
        }),
      ),
    );
    offs.push(
      window.jarvis.onAsk?.((p) => {
        setAsks((prev) => {
          const next = new Map(prev);
          if (p.questions.length === 0) next.delete(p.workspaceId);
          else next.set(p.workspaceId, p);
          return next;
        });
      }) ?? (() => undefined),
    );
    return () => {
      cancelled = true;
      for (const off of offs) off();
    };
    // registered once — do not re-register on workspace switch
  }, []);

  // status pushes are the usual repaint trigger, but an all-idle fleet would
  // otherwise freeze every card's age at whatever it read when home opened
  useEffect(() => {
    if (!showHome) return;
    const id = setInterval(() => setCardNow(Date.now()), 15000);
    setCardNow(Date.now());
    return () => clearInterval(id);
  }, [showHome]);

  // re-scan and re-settle. Highlights are cleared only for a single workspace
  // — the fleet refresh on the command center leaves them alone, as before.
  const refreshGraph = useCallback(() => {
    if (!showHome && active) resetHighlights(stateRef.current);
    graphs.refresh();
  }, [showHome, active, graphs.refresh]);

  const addProject = useCallback(() => {
    window.jarvis.addProject().then(setWorkspaces).catch(console.error);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "F5") {
        e.preventDefault();
        refreshGraph();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [refreshGraph]);

  const updateSettings = (s: Settings) => {
    setSettings(s); // renderer owns live state; main just persists
    window.jarvis.setSettings(s).catch(console.error);
  };

  // this session's camera. Persisted as Settings.handControl, but kept
  // separately so a tracker failure can stop the camera without touching the
  // preference.
  const [cameraOn, setCameraOn] = useState(false);
  const graph3dHandle = useRef<Graph3DHandle | null>(null);
  const graphHandle = useRef<GraphHandle | null>(null);

  // Screen-pixel cursor. Do NOT mirror x here: hand-tracker.ts already does
  // it at the camera boundary ("mirror x so moving the hand right reads as
  // pointer-right — the same sign a mouse drag produces"), so `nx` arrives
  // already in pointer space. Mirroring again sends the dot the wrong way.
  //
  // Position is not React state: it arrives at tracker frame rate (~30Hz)
  // and is written straight to HandCursor's DOM node through the imperative
  // handle, so a moving hand does not reconcile the whole App tree on every
  // frame (I8). `hasCursor` is the one part that does need a render — the
  // one-time flip from "no frame yet" to "showing the dot".
  const cursorRef = useRef<{ x: number; y: number } | null>(null);
  const handCursorRef = useRef<HandCursorHandle>(null);
  const hasCursorRef = useRef(false);
  const [hasCursor, setHasCursor] = useState(false);
  // Which panel a pinch grabbed. `undefined` means "not decided yet this
  // gesture"; `null` means "decided: nothing" — the distinction is what stops
  // a graph pan that sweeps across a title bar from yanking that panel.
  const grabbedRef = useRef<PanelId | null | undefined>(undefined);

  // the session the home screen pins, and the only one voice talks to
  const orchestrator =
    workspaces.find((w) => w.isSelf) ?? workspaces[0] ?? null;

  // The rail, the cards and the ring are graph views, and the main agent has
  // no graph. You reach its session from home, which already pins it.
  const fleet = useMemo(
    () => workspaces.filter((w) => !w.isSelf),
    [workspaces],
  );

  // the header sits over Cards, Ring and Fleet, so it counts what they render:
  // the main agent's row has no card, no tile and no pip to point at
  const fleetStatuses = useMemo(
    () => statuses.filter((s) => fleet.some((w) => w.id === s.workspaceId)),
    [statuses, fleet],
  );

  // Reading order: chrome, then the rail, then the graph, then the terminal.
  // Stage 3's signal is a constant — nothing needs to load for the terminal
  // panel, it is last because it should be last.
  //
  // Stage 2 waits for the card pass to *settle*, not for a graph to exist: a
  // scan that comes back empty is an answer, and gating on `cardGraphs.size`
  // instead made the 1200ms fallback the normal path for every slow index —
  // the slot then faded in over nothing and the real graph arrived after it,
  // unanimated.
  //
  // The holds are how long each stage's own entrance runs, so nothing starts
  // over something still moving. Only the cards view staggers inside the slot;
  // the ring and fleet views are a single fade.
  // Stage 0 also waits for a frame that actually reached the screen. Settings
  // resolve within a few ms of mount, so the entrance used to start while the
  // renderer was still evaluating its startup work — xterm, the PTY, the first
  // graph fetches — and a compositor animation that never gets a first frame is
  // an animation nobody sees. Two rAFs is the wait: the callbacks queue behind
  // whatever is blocking the main thread, so the second one lands after it.
  const [painted, setPainted] = useState(false);
  useEffect(() => {
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => setPainted(true));
    });
    return () => {
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
    };
  }, []);

  const stage = useBootStage(
    [
      settingsReady && painted, // 0 → header + bezel
      workspaces.length > 0, // 1 → rail
      cardsLoaded, // 2 → graph slot
      true, // 3 → terminal / inbox
    ],
    [
      ENTER_MS,
      runMs(railSeats(fleet)),
      runMs(showHome && homeView === "cards" ? fleet.length : 1),
    ],
  );

  const hands = useHandControl({
    cameraOn,
    actionsRef: handActionsRef,
    // a failure stops this session's camera without rewriting the preference:
    // the setting stays on and the user decides whether to untick it. A
    // failure that edited settings would quietly kill the feature and leave
    // no trace of why (design §3).
    onCameraFailed: () => setCameraOn(false),
  });

  // a disarm mid-drag must not latch across the re-arm either (ledger #11)
  useEffect(() => {
    if (!hands.armed) grabbedRef.current = undefined;
  }, [hands.armed]);

  // two affordances onto one value: the ✋ button and the panel checkbox both
  // land here, so either turns the camera off — and a click after a tracker
  // failure retries even though the persisted value is already true
  const setHandControl = (on: boolean) => {
    setCameraOn(on);
    if (settings.handControl !== on)
      updateSettings({ ...settings, handControl: on });
  };

  // auto-start at launch: turning hands on is a decision about how you drive
  // the app, not one to re-make every session (design §3). Launch only —
  // every later change goes through setHandControl.
  useEffect(() => {
    if (settingsReady && settings.handControl) setCameraOn(true);
  }, [settingsReady]);

  // this session's microphone. Persisted as Settings.voiceControl, but kept
  // separately so a tracker failure can stop the mic without touching the
  // preference — the same split as cameraOn/handControl above.
  const [micOn, setMicOn] = useState(false);
  // Reported by VoiceWave once the head resolves, so the settings panel can
  // grey the mouth switch without loading the model a second time. Null while
  // voice is off, which is why the switch is not disabled on null.
  const [rigKind, setRigKind] = useState<RigKind | null>(null);
  // Why the head is missing, when it is. A model that fails to load leaves an
  // empty box, and the box is nowhere near the setting that chose the model.
  const [headError, setHeadError] = useState<string | null>(null);
  // Whether the loaded head carries colours of its own. Null until one loads,
  // which is why the check below is against false rather than falsy — an
  // unloaded head must not read as a head with nothing to show.
  const [headColoured, setHeadColoured] = useState<boolean | null>(null);
  const voice = useVoiceControl({
    micOn,
    micDeviceId: settings.micDeviceId,
    targetId: orchestrator?.id ?? null,
    onMicFailed: () => setMicOn(false),
  });

  const setVoiceControl = (on: boolean) => {
    setMicOn(on);
    if (settings.voiceControl !== on)
      updateSettings({ ...settings, voiceControl: on });
  };

  useEffect(() => {
    if (settingsReady && settings.voiceControl) setMicOn(true);
  }, [settingsReady]);

  // A new head answers all three of these itself, but only once it loads.
  // Clearing them on the way in stops the previous head's verdict standing
  // in for the new one — forever, if the new one never loads.
  useEffect(() => {
    setRigKind(null);
    setHeadError(null);
    setHeadColoured(null);
  }, [micOn, settings.headModel]);

  // The mouth. Only the orchestrator's row is read, and only once per turn
  // — spokenRef is a ref because speaking must not itself cause a render.
  const spokenRef = useRef<Spoken>({ text: "", at: null });
  // A restored session (jarvis-inbox.json carries a last message) or a
  // manual mic-on mid-session both find a message already sitting in
  // `statuses` — without this, the false→true edge reads it aloud as if it
  // just happened. `orchestrator` and `micOn` arrive from two independent
  // async IPC calls with no ordering between them, so arming here cannot
  // depend on `orchestrator` being known yet — it only records that this
  // mic-on session owes a swallow. The speaking effect below consumes the
  // flag once both an orchestrator and a message are actually available,
  // however late that turns out to be. Declared before the speaking effect
  // so it runs first within the same commit and the armed flag is what that
  // effect sees.
  const swallowNextRef = useRef(false);
  const prevMicOnRef = useRef(false);
  useEffect(() => {
    if (micOn && !prevMicOnRef.current) swallowNextRef.current = true;
    prevMicOnRef.current = micOn;
  }, [micOn]);
  useEffect(() => {
    if (!micOn || !orchestrator) return;
    const status = statuses.find((s) => s.workspaceId === orchestrator.id);
    if (swallowNextRef.current) {
      // spent on the orchestrator first ROW, message or not. Waiting for a
      // non-empty message instead keeps the flag armed through a fresh
      // install (no jarvis-inbox.json to restore) and eats the first real
      // reply of the session — the one you most need to hear.
      if (!status) return; // no row yet; nothing has been restored or missed
      spokenRef.current = {
        text: status.message ?? "",
        at: status.messageAt ?? null,
      };
      swallowNextRef.current = false;
      return;
    }
    const say = nextUtterance(status, spokenRef.current, voice.capturing);
    // A turn is covered once it has been looked at, spoken or not: the
    // turn-end copy of a jarvis_say line is skipped, and the next turn's
    // identical reply must not be read as that same copy again.
    if (!voice.capturing && status?.message) {
      spokenRef.current = {
        text: status.message,
        at: status.messageAt ?? null,
      };
    }
    if (say) void speak(say);
  }, [statuses, micOn, orchestrator, voice.capturing]);
  // A fixed template over the question's own words — not a summary, and not
  // composed text: every word that carries meaning came out of the payload.
  // Only the current question, and only for the session we listen to.
  useEffect(() => {
    if (!micOn) return;
    const ws = workspaces.find((w) => w.isSelf) ?? workspaces[0];
    const prompt = ws ? asks.get(ws.id) : undefined;
    if (!ws || !prompt) return;
    const q = prompt.questions[0];
    const line = `${ws.name} asks: ${q.question}. Options: ${q.options
      .map((o) => o.label)
      .join(", ")}.`.slice(0, 500);
    if (spokenRef.current.text === line) return;
    spokenRef.current = { ...spokenRef.current, text: line };
    void speak(line);
  }, [asks, micOn, workspaces]);
  // A long message keeps reading after voice is switched off without this —
  // the mouth must go quiet on the same transition that closes the ear.
  useEffect(() => {
    if (!micOn) stopSpeaking();
  }, [micOn]);
  // micOnRef, not a dep: onSay's listener is registered once ([] below) and
  // must still read the current mic state on every call, not the state at
  // subscription time.
  const micOnRef = useRef(micOn);
  micOnRef.current = micOn;
  // jarvis_say speaks now, and writes the same text into spokenRef with no
  // turn, so the agent's identical turn-end message is skipped — one thought
  // is never said twice. spokenRef is written even while muted: the dedupe
  // must still catch the turn-end echo once voice comes back on.
  useEffect(
    () =>
      window.jarvis.onSay((text) => {
        spokenRef.current = { text: text.trim(), at: null };
        if (micOnRef.current) void speak(text);
      }),
    [],
  );

  // Cards registers nothing, so a pulse there would claim hands drive
  // something on the one view where they don't (design §3)
  const hasActions = !(showHome && homeView === "cards");

  const onCursor = useCallback((nx: number, ny: number) => {
    const x = nx * window.innerWidth;
    const y = ny * window.innerHeight;
    cursorRef.current = { x, y };
    handCursorRef.current?.setPosition(x, y);
    if (!hasCursorRef.current) {
      hasCursorRef.current = true;
      setHasCursor(true);
    }
  }, []);

  // Only panels the workspace view is actually rendering may be grabbed. The
  // persisted geometry map (`panels`) also carries panels that are closed or
  // deck-cleared; hit-testing against it latches a dead title bar, silently
  // drags an invisible panel, and refuses to pan the graph for the rest of
  // the gesture (I1).
  const liveWorkspacePanels = useCallback((): PanelMap => {
    if (deckCleared) return {};
    const live: PanelMap = {};
    if (active) live.terminal = panelState("terminal");
    if (previewNode !== null && active) live.preview = panelState("preview");
    // SETTINGS_Z here as well as at render, so a pinch hit-tests the stack the
    // way it looks rather than the way it is stored
    if (showSettings)
      live.settings = { ...panelState("settings"), z: SETTINGS_Z };
    if (showMouthPicker) live.mouth = panelState("mouth");
    if (showTodos) live.todos = panelState("todos");
    if (composeShown) live.compose = panelState("compose");
    if (viewShown) live.view = panelState("view");
    return live;
  }, [
    deckCleared,
    active,
    previewNode,
    showSettings,
    showMouthPicker,
    showTodos,
    composeShown,
    viewShown,
    panels,
  ]);

  const onHandDrag = useCallback(
    (dx: number, dy: number, fallback: (dx: number, dy: number) => void) => {
      const live = liveWorkspacePanels();
      const target = grabTarget(live, cursorRef.current, grabbedRef.current);
      // the latch survives a frame where the cursor leaves the title bar — but
      // not one where the panel itself went away (clear-the-deck, a close),
      // which would otherwise keep writing geometry for something invisible
      const id = target && target in live ? target : null;
      grabbedRef.current = id;
      if (!id) return fallback(dx, dy);
      // no negation: `dx` is documented "sign matches pointer", and both
      // use-panel-drag's movePanel call and Graph's pan() consume it unmodified
      const px = dx * window.innerWidth;
      const py = dy * window.innerHeight;
      setPanel(
        id,
        movePanel(panelState(id), px, py, {
          width: window.innerWidth,
          height: window.innerHeight,
        }),
      );
    },
    [liveWorkspacePanels, setPanel],
  );

  // Edge-snap whatever the pinch was holding when it released (spec §7),
  // then clear the latch so the next pinch decides afresh.
  const snapGrabbed = useCallback(() => {
    const id = grabbedRef.current;
    if (id)
      setPanel(
        id,
        snapToEdges(panelState(id), {
          width: window.innerWidth,
          height: window.innerHeight,
        }),
      );
    grabbedRef.current = undefined;
  }, [setPanel, panels]);

  // the workspace graph's own map, registered only while a workspace is on
  // screen; on home the mounted view owns the map outright. Deliberate cut:
  // no drag on 3D — orbit is 3D's navigation (design §6).
  useHandActions(
    handActionsRef,
    settings.dimensions === "3d"
      ? {
          cursor: onCursor,
          orbit: (v) => graph3dHandle.current?.spin(v),
          zoom: (f) => graph3dHandle.current?.zoom(f),
          // eslint-disable-next-line @typescript-eslint/no-empty-function
          drag: (dx, dy) => onHandDrag(dx, dy, () => {}),
          snap: snapGrabbed,
        }
      : {
          cursor: onCursor,
          drag: (dx, dy) =>
            onHandDrag(dx, dy, (a, b) => graphHandle.current?.pan(a, b)),
          snap: snapGrabbed,
          zoom: (f) => graphHandle.current?.zoom(f),
        },
    !showHome,
  );

  const domains = useMemo(() => domainsOf(graph), [graph]);
  // the open workspace's identity hue — the same one Fleet paints its cluster
  // with, so a project looks like itself in both places
  const activeHue = useMemo(
    () => (active ? hueOfWorkspace(active, fleet, settings.mainColors) : 0),
    [active, fleet, settings.mainColors],
  );
  // keyed by name, because a to-do's @token names a workspace, not its id
  const todoColors = useMemo(
    () =>
      Object.fromEntries(
        fleet.map((ws) => [
          ws.name,
          settings.mainColors?.[ws.id] ??
            hueToHex(hueOfWorkspace(ws, fleet, settings.mainColors)),
        ]),
      ),
    [fleet, settings.mainColors],
  );

  // Seed a workspace's groups once, from its own top-level folders, as soon as
  // its graph exists — off `cardGraphs`, which fills for the whole fleet at
  // boot, not off the open workspace. Keying this on `active` meant a project
  // drew no colour until you opened it, so the cards and the fleet showed the
  // unseeded fallback and the palette appeared to change when you came back.
  //
  // `id in groups` marks a workspace seeded, so later deletions are respected.
  // A workspace with no folders is skipped rather than marked: its graph may
  // still be loading, and marking it would freeze it empty. That leaves it in
  // `pending` forever, which is why the write is guarded on a real change —
  // without that guard this effect would write settings, wake on its own
  // write, and loop.
  useEffect(() => {
    if (!settingsReady) return;
    const pending = fleet
      .filter((ws) => !(ws.id in settings.groups))
      .map((ws) => [ws, cardGraphs.get(ws.id)] as const)
      .filter((pair): pair is [Workspace, VaultGraph] => pair[1] !== undefined);
    if (pending.length === 0) return;

    const groups = { ...settings.groups };
    const mainColors = { ...settings.mainColors };
    let log = [...(settings.recentHues ?? [])];
    let changed = false;

    for (const [ws, g] of pending) {
      // The log threads through the whole loop, so two projects seeded in the
      // same pass cannot come out the same green either.
      const seeded = seedGroups(g, log);
      if (!seeded) continue;
      groups[ws.id] = seeded.groups;
      mainColors[ws.id] = seeded.main;
      log = [...log, ...seeded.hues].slice(-RECENT_PICKS);
      changed = true;
    }

    if (changed)
      updateSettings({ ...settings, groups, mainColors, recentHues: log });
  }, [settingsReady, fleet, cardGraphs, settings]);

  const resolveLink = useMemo(
    () =>
      buildWikilinkResolver(
        graph.nodes.filter((n) => n.type === "note").map((n) => n.id),
      ),
    [graph],
  );
  // code workspaces have no sections; force "both" so nothing vanishes.
  // Deps are the four filter fields, NOT `settings` — panel drags and window
  // resizes rewrite `settings.panels`, and a whole-object dep would hand
  // ForceGraph a new graphData identity and restart the simulation (I9).
  const visible = useMemo(
    () =>
      filterGraph(graph, {
        sectionFilter:
          active?.kind === "code" ? "both" : settings.sectionFilter,
        search,
        showTags: settings.showTags,
        showOrphans: settings.showOrphans,
      }),
    [
      graph,
      settings.sectionFilter,
      settings.showTags,
      settings.showOrphans,
      search,
      active?.kind,
    ],
  );

  const view = settings.views[settings.dimensions];

  const telemetry = showHome
    ? `COMMAND CENTER · ${fleet.length} WORKSPACES · ` +
      `${fleetStatuses.filter((s) => s.kind === "asking").length} ASKING · ` +
      `${fleetStatuses.filter((s) => s.kind === "blocked").length} BLOCKED · ` +
      `${fleetStatuses.filter((s) => s.kind === "working").length} WORKING`
    : `FLEET ${workspaces.length} · NODES ${graph.nodes.length} · ` +
      `EDGES ${graph.edges.length} · ` +
      `SRC ${(active?.sourceId ?? "unknown").toUpperCase()}`;

  const activeStatus = statuses.find((s) => s.workspaceId === active?.id);
  const footRight = showHome
    ? `FLEET READS ${fleetStatuses.reduce((n, s) => n + s.reads, 0)} · ` +
      `EDITS ${fleetStatuses.reduce((n, s) => n + s.edits, 0)}`
    : `READS ${activeStatus?.reads ?? 0} · EDITS ${activeStatus?.edits ?? 0}`;

  const homeViewToggle = (
    <Segmented<HomeView>
      options={HOME_VIEW_OPTIONS}
      value={homeView}
      onChange={setHomeView}
    />
  );

  // hands + refresh + settings — shown on the workspace graph and the command
  // center
  const graphButtons = (
    <>
      <HandToggle
        cameraOn={cameraOn}
        armed={hands.armed}
        hasActions={hasActions}
        error={hands.error}
        onToggle={() => setHandControl(!cameraOn)}
        onRearm={hands.rearm}
      />
      <VoiceToggle
        micOn={micOn}
        capturing={voice.capturing}
        error={voice.error}
        onToggle={() => setVoiceControl(!micOn)}
      />
      <TodoToggle
        open={showTodos}
        onToggle={() => {
          if (!showTodos) focusPanel("todos");
          setShowTodos(!showTodos);
        }}
      />
      <button
        className={BTN_IDLE + " text-[13px]"}
        title="Refresh graph (F5)"
        onClick={refreshGraph}
      >
        ↻
      </button>
      <button
        className={BTN_IDLE + " text-[13px]"}
        title="Graph settings"
        onClick={() => setShowSettings((v) => !v)}
      >
        ⚙
      </button>
      {/* the one way back for anything hidden */}
      <button
        data-testid="clear-deck"
        className={BTN_IDLE + " border-dashed text-[13px]"}
        title={deckCleared ? "Show panels" : "Clear the deck"}
        onClick={() => setDeckCleared((v) => !v)}
      >
        ▤
      </button>
    </>
  );

  return (
    <div className="relative h-full w-full overflow-hidden bg-abyss">
      <div
        className={
          "absolute inset-0" + (stage >= 2 ? " boot-fade" : " boot-hold")
        }
      >
        <GraphSlot>
          {({ width, height }) =>
            showHome ? (
              <>
                {homeView === "fleet" ? (
                  <FleetGraph
                    workspaces={fleet}
                    mainColors={settings.mainColors}
                    graphs={cardGraphs}
                    view={view}
                    dimensions={settings.dimensions}
                    width={width}
                    height={height}
                    actionsRef={handActionsRef}
                    onOpen={(ws) => {
                      setShowHome(false);
                      openWorkspace(ws);
                    }}
                  />
                ) : homeView === "ring" ? (
                  <Ring
                    workspaces={fleet}
                    mainColors={settings.mainColors}
                    statuses={statuses}
                    graphs={cardGraphs}
                    getStore={storeFor}
                    groups={settings.groups}
                    view={settings.views["3d"]}
                    filters={{
                      sectionFilter: settings.sectionFilter,
                      showTags: settings.showTags,
                      showOrphans: settings.showOrphans,
                    }}
                    width={width}
                    height={height}
                    indexing={indexing}
                    layoutEpoch={graphs.fleetEpoch}
                    actionsRef={handActionsRef}
                    centreId={ringCentreId}
                    onCentre={setRingCentreId}
                    onIndex={graphs.indexProject}
                    onOpen={(ws) => {
                      setShowHome(false);
                      openWorkspace(ws);
                    }}
                  />
                ) : (
                  <MissionControl
                    workspaces={fleet}
                    mainColors={settings.mainColors}
                    statuses={statuses}
                    graphs={cardGraphs}
                    getStore={storeFor}
                    groups={settings.groups}
                    view={settings.views["2d"]}
                    filters={{
                      sectionFilter: settings.sectionFilter,
                      showTags: settings.showTags,
                      showOrphans: settings.showOrphans,
                    }}
                    now={cardNow}
                    stagger={stage >= 2}
                    indexing={indexing}
                    onIndex={graphs.indexProject}
                    onSelect={(ws) => {
                      setShowHome(false);
                      openWorkspace(ws);
                    }}
                  />
                )}
              </>
            ) : (
              <>
                {!settingsReady ? null : settings.dimensions === "3d" ? (
                  <Graph3D
                    graph={visible}
                    domains={domains}
                    baseHue={activeHue}
                    groups={groupsFor(settings, active?.id)}
                    display={view.display}
                    forces={view.forces}
                    stateRef={stateRef}
                    onNodeClick={setPreviewNode}
                    focusNode={previewNode}
                    rotationPaused={previewNode !== null}
                    handleRef={graph3dHandle}
                    width={width}
                    height={height}
                  />
                ) : (
                  <Graph
                    graph={visible}
                    domains={domains}
                    baseHue={activeHue}
                    groups={groupsFor(settings, active?.id)}
                    display={view.display}
                    forces={view.forces}
                    stateRef={stateRef}
                    onNodeClick={setPreviewNode}
                    focusNode={previewNode}
                    handleRef={graphHandle}
                    width={width}
                    height={height}
                  />
                )}
                {active?.kind === "code" &&
                  !graphLoading &&
                  graph.nodes.length === 0 && (
                    <div className="absolute inset-0 z-10 flex items-center justify-center">
                      <EmptyGraph
                        state={indexing[active.id]?.state ?? "idle"}
                        error={indexing[active.id]?.error}
                        onIndex={() => graphs.indexProject(active.id)}
                      />
                    </div>
                  )}
              </>
            )
          }
        </GraphSlot>
      </div>
      {/* The wrapper spans the full window height but the rail's own column
          is mostly empty below the pips — without this the left 56px of a
          full-bleed graph would be a dead strip. The buttons re-enable
          themselves; see the note below. */}
      <div className="pointer-events-none absolute top-0 left-0 z-20 h-full [&_button]:pointer-events-auto">
        <WorkspaceRail
          workspaces={fleet}
          activeId={active?.id ?? null}
          statuses={statuses}
          homeActive={showHome}
          stagger={stage >= 1}
          onAddProject={addProject}
          onHome={() => setShowHome(true)}
          onSelect={(ws) => {
            setShowHome(false);
            openWorkspace(ws);
          }}
        />
      </div>
      {showHome ? (
        <HomeHeader
          statuses={fleetStatuses}
          enterClass={stage >= 0 ? "boot-in" : "boot-hold"}
        >
          {homeViewToggle}
          {graphButtons}
        </HomeHeader>
      ) : (
        <div className={TOP_ROW + (stage >= 0 ? " boot-in" : " boot-hold")}>
          {active?.kind === "code" && (
            <Segmented<CodeGraphLevel>
              options={GRAPH_LEVEL_OPTIONS}
              value={settings.codeGraphLevel}
              onChange={(codeGraphLevel: CodeGraphLevel) =>
                updateSettings({ ...settings, codeGraphLevel })
              }
            />
          )}
          {graphButtons}
        </div>
      )}
      <div className={stage >= 0 ? "boot-fade" : "boot-hold"}>
        <Bezel
          enterClass={stage >= 0 ? "boot-frame" : undefined}
          title={`JARVIS · V${appVersion}`}
          telemetry={telemetry}
          footRight={footRight}
          footLeft={
            // bottom-anchored column: the slot sets only `bottom`, so the head
            // and wave stack upward and never cover the replay scrubber. The
            // slot is pointer-transparent; only the scrubber opts back in.
            <div className="flex flex-col items-start gap-2">
              {micOn ? (
                <VoiceWave
                  headModel={settings.headModel}
                  colour={settings.headColor}
                  mouth={mouthOn(settings)}
                  mouthRegion={settings.headMouths?.[headKey(settings)]}
                  onRig={setRigKind}
                  onHeadError={setHeadError}
                  onColoured={setHeadColoured}
                  visible={stage >= 0}
                />
              ) : null}
              {showHome ? null : (
                <div className="pointer-events-auto self-stretch">
                  <Timeline
                    log={(active && logsRef.current.get(active.id)) || []}
                    index={replayIndex}
                    onScrub={onScrub}
                  />
                </div>
              )}
            </div>
          }
        />
      </div>
      {!showHome && previewNode && active && (
        <Panel
          id="preview"
          title={`PREVIEW · ${previewNode.toUpperCase()}`}
          state={panelState("preview")}
          focused={focusedPanel === "preview"}
          hidden={deckCleared}
          foldTo="left"
          onChange={(next) => setPanel("preview", next)}
          onFocus={() => focusPanel("preview")}
          onClose={() => setPreviewNode(null)}
        >
          <Preview
            nodeId={previewNode}
            revision={previewRev}
            workspace={active}
            resolveLink={resolveLink}
            onNavigate={setPreviewNode}
            onClose={() => setPreviewNode(null)}
          />
        </Panel>
      )}

      {(() => {
        const ws = showHome ? orchestrator : active;
        if (!ws) return null;
        // home's terminal collapses to an inbox strip rather than to its title
        // bar — the fleet's state is what you want while the session is parked
        const inboxOnly = showHome && panelState("terminal").collapsed;
        return (
          <Panel
            id="terminal"
            title={`${showHome ? "ORCHESTRATOR" : "SESSION"} // ${ws.name.toUpperCase()}`}
            compactWidth={
              showHome ? Math.round(viewport.width * 0.22) : undefined
            }
            state={panelState("terminal")}
            focused={focusedPanel === "terminal"}
            hidden={deckCleared}
            enterClass={stage >= 3 ? "boot-in" : "boot-hold"}
            onChange={(next) => setPanel("terminal", next)}
            onFocus={() => focusPanel("terminal")}
          >
            <TerminalPanel
              workspace={ws}
              live={statuses.some((s) => s.workspaceId === ws.id && s.live)}
              inbox={showHome ? { workspaces, statuses } : undefined}
              inboxOnly={inboxOnly}
              visible={stage >= 3}
            />
          </Panel>
        );
      })()}

      {/* rendered whether or not it is open: the ⚙ closes this panel from
          outside its title bar, and a panel React has already unmounted has no
          exit left to play. `open` runs it, then Panel drops to null itself. */}
      <Panel
        id="settings"
        title="GRAPH SETTINGS"
        open={showSettings}
        state={{ ...panelState("settings"), z: SETTINGS_Z }}
        focused={focusedPanel === "settings"}
        hidden={deckCleared}
        onChange={(next) => setPanel("settings", next)}
        onFocus={() => focusPanel("settings")}
        onClose={() => setShowSettings(false)}
      >
        <GraphSettingsPanel
          settings={settings}
          activeId={active?.id ?? null}
          search={search}
          onSearchChange={setSearch}
          onSettingsChange={updateSettings}
          onHandControl={setHandControl}
          onVoiceControl={setVoiceControl}
          onResetHighlights={() => resetHighlights(stateRef.current)}
          showSections={active?.kind !== "code"}
          rigKind={rigKind}
          mouthOn={mouthOn(settings)}
          headError={headError}
          headColoured={headColoured}
          onPickMouth={() => setShowMouthPicker(true)}
        />
      </Panel>

      {/* rendered whether or not it is open, like settings: the ☑ and
          jarvis_todos both open it from outside its title bar */}
      <Panel
        id="todos"
        title="TO-DO"
        open={showTodos}
        state={panelState("todos")}
        focused={focusedPanel === "todos"}
        hidden={deckCleared}
        onChange={(next) => setPanel("todos", next)}
        onFocus={() => focusPanel("todos")}
        onClose={() => setShowTodos(false)}
      >
        <TodoPanel
          list={todoList}
          projects={todoProjects}
          colors={todoColors}
          editing={composeShown ? editTarget : null}
          onOp={onTodoOp}
          onNew={() => openCompose({ mode: "add" })}
          onEdit={(todo, project) =>
            openCompose({ mode: "edit", todo, project })
          }
          onView={openView}
          onOpenProject={(name) => {
            const ws = fleet.find((w) => w.name === name);
            if (!ws) return;
            setShowHome(false);
            openWorkspace(ws);
          }}
          onOverflow={growTodos}
        />
      </Panel>

      <Panel
        id="compose"
        title={compose.request.mode === "add" ? "NEW TASK" : "EDIT TASK"}
        open={composeShown}
        state={panelState("compose")}
        focused={focusedPanel === "compose"}
        hidden={deckCleared}
        onChange={(next) => setPanel("compose", next)}
        onFocus={() => focusPanel("compose")}
        onClose={closeCompose}
      >
        <TodoComposer
          key={compose.seq}
          request={compose.request}
          projects={todoProjects}
          colors={todoColors}
          onOp={onTodoOp}
          onClose={closeCompose}
        />
      </Panel>

      <Panel
        id="view"
        title="TASK"
        open={viewShown}
        state={panelState("view")}
        focused={focusedPanel === "view"}
        hidden={deckCleared}
        onChange={(next) => setPanel("view", next)}
        onFocus={() => focusPanel("view")}
        onClose={closeView}
      >
        {taskView.todo && (
          <TodoView
            key={taskView.seq}
            todo={taskView.todo}
            project={taskView.project}
            colors={todoColors}
            onOp={onTodoOp}
            onEdit={() => {
              const todo = taskView.todo;
              if (!todo) return;
              closeView();
              openCompose({ mode: "edit", todo, project: taskView.project });
            }}
            onClose={closeView}
          />
        )}
      </Panel>

      {(() => {
        const own = showHome ? orchestrator : active;
        const prompt = pickAsk(asks, own?.id);
        const ws =
          prompt && workspaces.find((w) => w.id === prompt.workspaceId);
        if (!ws || !prompt) return null;
        return (
          <Panel
            id="ask"
            title="QUESTION"
            badge={<span className="text-[10px] text-ink-dim">{ws.name}</span>}
            state={{ ...panelState("ask"), z: ASK_Z }}
            focused={focusedPanel === "ask"}
            hidden={deckCleared}
            onChange={(next) => setPanel("ask", next)}
            onFocus={() => focusPanel("ask")}
            // closes the app's copy only — Claude Code is still waiting, and
            // the terminal still shows the picker
            onClose={() =>
              setAsks((prev) => {
                const next = new Map(prev);
                next.delete(ws.id);
                return next;
              })
            }
          >
            <AskPanel
              // a different question starts at its own first page
              key={`${prompt.workspaceId}:${prompt.ts}`}
              prompt={prompt}
              workspaceName={ws.name}
              onAnswer={(writes) => {
                askWriteRef.current = askWriteRef.current
                  .then(async (): Promise<void> => {
                    // SEPARATE writes, 80 ms apart — never merge them
                    for (const [i, w] of writes.entries()) {
                      if (i > 0) await new Promise((r) => setTimeout(r, 80));
                      await window.jarvis.ptyInput(ws.id, w);
                    }
                  })
                  // a failed write must not strand every answer behind it
                  .catch((): void => undefined);
              }}
            />
          </Panel>
        );
      })()}

      {showMouthPicker && (
        <Panel
          id="mouth"
          title="PICK THE MOUTH"
          state={panelState("mouth")}
          focused={focusedPanel === "mouth"}
          hidden={deckCleared}
          onChange={(next) => setPanel("mouth", next)}
          onFocus={() => focusPanel("mouth")}
          onClose={() => setShowMouthPicker(false)}
        >
          <MouthPicker
            headModel={settings.headModel}
            initial={settings.headMouths?.[headKey(settings)]}
            onDone={(region) => {
              const key = headKey(settings);
              const next = { ...(settings.headMouths ?? {}) };
              if (region) next[key] = region;
              else delete next[key];
              updateSettings({ ...settings, headMouths: next });
              setShowMouthPicker(false);
            }}
          />
        </Panel>
      )}
      {/* `!showHome`: only the workspace graph registers `cursor`, so on Home
          the dot would otherwise freeze at its last workspace position and
          sit there stationary on a view where hands drive nothing (design §3,
          the same reason Cards suppresses the ✋ pulse). */}
      <HandCursor
        ref={handCursorRef}
        initialX={cursorRef.current?.x ?? 0}
        initialY={cursorRef.current?.y ?? 0}
        visible={cameraOn && hands.armed && !showHome && hasCursor}
      />
    </div>
  );
}
