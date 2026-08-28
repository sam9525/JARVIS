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
import WorkspaceRail from "./home/WorkspaceRail";
import MissionControl from "./home/MissionControl";
import HomeHeader from "./home/HomeHeader";
import TerminalPanel from "./terminal/TerminalPanel";
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
import Panel from "./ui/Panel";
import {
  SETTINGS_Z,
  defaultPanel,
  grabTarget,
  movePanel,
  raise,
  rescaleAll,
  snapToEdges,
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
import { defaultSettings, groupsFor } from "../shared/types";
import {
  RECENT_PICKS,
  hueOfWorkspace,
  hueToHex,
  pickHues,
} from "./graph/workspace-color";
import { createPreviewOpener } from "./preview/preview-opener";
import type {
  CodeGraphLevel,
  HomeView,
  PanelId,
  PanelMap,
  PanelState,
  Settings,
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
import { nextUtterance, speak, stopSpeaking } from "./voice/speak";
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

// A folder smaller than this seeds no stored group. Its nodes still draw a
// colour — the domain spread off the workspace's main hue — but a halo and a
// settings entry for four notes is clutter, not information.
const MIN_GROUP_NODES = 5;

const fold = (m: PanelMap): PanelMap =>
  m.terminal ? { ...m, terminal: { ...m.terminal, collapsed: true } } : m;

/** absent entries fall back to defaultPanel, which already folds the terminal */
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
  const [showHome, setShowHome] = useState(true); // open on the command center
  const [homeView, setHomeView] = useState<HomeView>("cards");
  // MissionControl is hook-free so it stays testable without a DOM — the
  // clock that keeps its "40s ago" honest therefore lives here.
  const [cardNow, setCardNow] = useState(() => Date.now());

  const [focusedPanel, setFocusedPanel] = useState<PanelId>("terminal");
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

  const panelState = (id: PanelId): PanelState =>
    panels[id] ?? defaultPanel(id, viewport);

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
      setSettings((s) => ({
        ...s,
        panels: {
          ...s.panels,
          [layoutId]: { ...s.panels[layoutId], ...patch },
        },
      }));
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
  const { graph, graphLoading, layoutEpoch, cardGraphs, indexing } = graphs;

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
        const fresh = appendEvent(logsRef.current, e);
        applyEvent(storeFor(e.workspaceId), e, performance.now());
        if (e.workspaceId === activeIdRef.current) {
          if (fresh) onScrub(null); // the past being replayed no longer exists
          setLogRev((n) => n + 1);
          onPreviewEvent(e);
        }
      }),
    );
    offs.push(window.jarvis.onStatus(setStatuses));
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

  // The mouth. Only the orchestrator's row is read, and only once per message
  // — spokenRef is a ref because speaking must not itself cause a render.
  const spokenRef = useRef("");
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
      spokenRef.current = status.message?.trim() ?? "";
      swallowNextRef.current = false;
      return;
    }
    const say = nextUtterance(status, spokenRef.current, voice.capturing);
    if (!say) return;
    spokenRef.current = say;
    void speak(say);
  }, [statuses, micOn, orchestrator, voice.capturing]);
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
  // jarvis_say speaks now, and writes the same text into spokenRef so the
  // agent's identical turn-end message is skipped by nextUtterance's existing
  // equality check — one thought is never said twice. spokenRef is written
  // even while muted: the dedupe must still catch the turn-end echo once
  // voice comes back on.
  useEffect(
    () =>
      window.jarvis.onSay((text) => {
        spokenRef.current = text.trim();
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
    return live;
  }, [deckCleared, active, previewNode, showSettings, panels]);

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
      const folders = domainsOf(g);
      if (folders.length === 0) continue;
      // One random hue per folder, each clearing the last RECENT_PICKS. The
      // log threads through the whole loop, so two projects seeded in the same
      // pass cannot come out the same green either.
      const hues = pickHues(folders.length, log);
      // A folder of a handful of notes does not earn a stored halo. It is left
      // out of settings, and its nodes fall through to the domain spread off
      // this workspace's main colour — a colour, never the pre-domain grey.
      const counts = new Map<string, number>();
      for (const n of g.nodes)
        if (n.domain) counts.set(n.domain, (counts.get(n.domain) ?? 0) + 1);
      groups[ws.id] = folders
        .map((d, i) => ({ query: `${d}/`, color: hueToHex(hues[i]) }))
        .filter((_, i) => (counts.get(folders[i]) ?? 0) > MIN_GROUP_NODES);
      // The biggest folder's colour is the project's identity, in Fleet and at
      // home — not the first hue drawn. Fleet paints a whole cluster with this,
      // and the colour a cluster reads as should be the one most of its nodes
      // already wear. Ties go to the first folder, which is alphabetical.
      const biggest = folders.reduce(
        (best, d, i) =>
          (counts.get(d) ?? 0) > (counts.get(folders[best]) ?? 0) ? i : best,
        0,
      );
      mainColors[ws.id] = hueToHex(hues[biggest]);
      log = [...log, ...hues].slice(-RECENT_PICKS);
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
      `${fleetStatuses.filter((s) => s.kind === "waiting").length} WAITING · ` +
      `${fleetStatuses.filter((s) => s.kind === "running").length} RUNNING`
    : `FLEET ${workspaces.length} · NODES ${graph.nodes.length} · ` +
      `EDGES ${graph.edges.length} · ` +
      `SRC ${(active?.sourceId ?? "unknown").toUpperCase()}`;

  const activeStatus = statuses.find((s) => s.workspaceId === active?.id);
  const footRight = showHome
    ? `FLEET READS ${fleetStatuses.reduce((n, s) => n + s.reads, 0)} · ` +
      `EDITS ${fleetStatuses.reduce((n, s) => n + s.edits, 0)}`
    : `READS ${activeStatus?.reads ?? 0} · EDITS ${activeStatus?.edits ?? 0}`;

  const homeViewToggle = (
    <Segmented
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
      <GraphSlot>
        {({ width, height }) =>
          showHome ? (
            <>
              {homeView === "fleet" ? (
                <FleetGraph
                  workspaces={workspaces}
                  mainColors={settings.mainColors}
                  graphs={cardGraphs}
                  view={view}
                  dimensions={settings.dimensions}
                  layoutEpoch={graphs.fleetEpoch}
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
                  layoutEpoch={layoutEpoch}
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
                  layoutEpoch={layoutEpoch}
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
          onAddProject={addProject}
          onHome={() => setShowHome(true)}
          onSelect={(ws) => {
            setShowHome(false);
            openWorkspace(ws);
          }}
        />
      </div>
      {showHome ? (
        <HomeHeader statuses={fleetStatuses}>
          {homeViewToggle}
          {graphButtons}
        </HomeHeader>
      ) : (
        <div className={TOP_ROW}>
          {active?.kind === "code" && (
            <Segmented
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
      <Bezel
        title={`JARVIS · V${appVersion}`}
        telemetry={telemetry}
        footRight={footRight}
        footLeft={
          // bottom-anchored column: the slot sets only `bottom`, so the head
          // and wave stack upward and never cover the replay scrubber. The
          // wave is pointer-transparent; the scrubber under it is not.
          <div className="flex flex-col items-start gap-2">
            <VoiceWave headModel={settings.headModel} />
            {showHome ? null : (
              <Timeline
                log={(active && logsRef.current.get(active.id)) || []}
                index={replayIndex}
                onScrub={onScrub}
              />
            )}
          </div>
        }
      />
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
            onChange={(next) => setPanel("terminal", next)}
            onFocus={() => focusPanel("terminal")}
          >
            <TerminalPanel
              workspace={ws}
              live={statuses.some((s) => s.workspaceId === ws.id && s.live)}
              inbox={showHome ? { workspaces, statuses } : undefined}
              inboxOnly={inboxOnly}
            />
          </Panel>
        );
      })()}

      {showSettings && (
        <Panel
          id="settings"
          title="GRAPH SETTINGS"
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
