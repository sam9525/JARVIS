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
import TerminalPanel from "./terminal/TerminalPanel";
import FleetGraph from "./graph/FleetGraph";
import Segmented from "./ui/Segmented";
import EmptyGraph from "./graph/EmptyGraph";
import Timeline from "./session/Timeline";
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
import { randomColor } from "../shared/random-color";
import { createPreviewOpener } from "./preview/preview-opener";
import type {
  CodeGraphLevel,
  HomeView,
  Settings,
  ToolEvent,
  Workspace,
  WorkspaceStatus,
} from "../shared/types";
import { buildWikilinkResolver } from "../shared/wikilink";

const HOME_VIEW_OPTIONS: { value: HomeView; label: string }[] = [
  { value: "cards", label: "Cards" },
  { value: "fleet", label: "Fleet" },
];

// vault workspaces have no symbol graph, so this toggle is code-only
const GRAPH_LEVEL_OPTIONS: { value: CodeGraphLevel; label: string }[] = [
  { value: "file", label: "Files" },
  { value: "symbol", label: "Symbols" },
];

export default function App() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [active, setActive] = useState<Workspace | null>(null);
  const [statuses, setStatuses] = useState<WorkspaceStatus[]>([]);
  const [previewNode, setPreviewNode] = useState<string | null>(null);
  const [settings, setSettings] = useState<Settings>(defaultSettings());
  // Graphs mount only after settings load: swapping the forces/display prop
  // identities while react-force-graph-3d's first async graphData flush is
  // still pending reheats an engine whose layout doesn't exist yet — the
  // animation loop throws and dies, leaving a permanent black screen.
  const [settingsReady, setSettingsReady] = useState(false);
  const [search, setSearch] = useState(""); // transient — cleared on restart
  const [showSettings, setShowSettings] = useState(false);
  const [showHome, setShowHome] = useState(true); // open on the command center
  const [homeView, setHomeView] = useState<HomeView>("cards");
  const [focusedId, setFocusedId] = useState<string | null>(null);
  // MissionControl is hook-free so it stays testable without a DOM — the
  // clock that keeps its "40s ago" honest therefore lives here.
  const [cardNow, setCardNow] = useState(() => Date.now());

  // one highlight store per workspace; Graph reads stateRef.current per frame,
  // so retargeting .current on switch is all a switch needs
  const storesRef = useRef(new Map<string, HighlightState>());
  const stateRef = useRef(emptyState());
  const activeIdRef = useRef<string | null>(null);

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
      graphs.openGraph(ws);
    },
    [onPreviewEvent, graphs.openGraph],
  );

  useEffect(() => {
    const offs: Array<() => void> = [];
    let cancelled = false;
    window.jarvis.getWorkspaces().then((list) => {
      if (cancelled) return;
      setWorkspaces(list);
      if (list.length === 0) return;
      openWorkspace(list[0]); // vault first
      setFocusedId(list[0].id); // command-center terminal starts on the vault
      const vaultId = list[0].id;
      // watcher only feeds the vault — cache under its id, show if on screen
      offs.push(
        window.jarvis.onGraph((g) => graphs.applyWatchedGraph(vaultId, g)),
      );
    });
    window.jarvis
      .getSettings()
      .then(setSettings)
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

  const domains = useMemo(() => domainsOf(graph), [graph]);

  // Seed a workspace's groups once, from its own top-level folders, the first
  // time we have its graph — so every project (not just the vault) gets group
  // halos. `id in groups` marks it seeded, so later deletions are respected.
  useEffect(() => {
    if (!settingsReady || !active || active.id in settings.groups) return;
    const seed = domains.map((d) => ({ query: `${d}/`, color: randomColor() }));
    if (seed.length === 0) return; // no graph yet, or no folders to group by
    updateSettings({
      ...settings,
      groups: { ...settings.groups, [active.id]: seed },
    });
  }, [settingsReady, active, domains, settings]);
  const resolveLink = useMemo(
    () =>
      buildWikilinkResolver(
        graph.nodes.filter((n) => n.type === "note").map((n) => n.id),
      ),
    [graph],
  );
  // code workspaces have no sections; force "both" so nothing vanishes
  const visible = useMemo(
    () =>
      filterGraph(graph, {
        sectionFilter:
          active?.kind === "code" ? "both" : settings.sectionFilter,
        search,
        showTags: settings.showTags,
        showOrphans: settings.showOrphans,
      }),
    [graph, settings, search, active],
  );

  const view = settings.views[settings.dimensions];

  // refresh + settings — shown on the workspace graph and the command center
  const graphButtons = (
    <>
      <button
        className="h-[30px] w-[30px] cursor-pointer rounded-full border border-edge bg-panel text-[13px] text-ink-dim transition-colors hover:border-accent hover:text-accent"
        title="Refresh graph (F5)"
        onClick={refreshGraph}
      >
        ↻
      </button>
      <button
        className="h-[30px] w-[30px] cursor-pointer rounded-full border border-edge bg-panel text-[13px] text-ink-dim transition-colors hover:border-accent hover:text-accent"
        title="Graph settings"
        onClick={() => setShowSettings((v) => !v)}
      >
        ⚙
      </button>
    </>
  );

  return (
    <div className="flex h-full w-full">
      <WorkspaceRail
        workspaces={workspaces}
        activeId={active?.id ?? null}
        statuses={statuses}
        homeActive={showHome}
        onAddProject={addProject}
        onHome={() => setShowHome(true)}
        onSelect={(ws) => {
          setShowHome(false);
          setFocusedId(ws.id); // terminal follows when you return home
          openWorkspace(ws);
        }}
      />
      {!showHome && previewNode && active && (
        <Preview
          nodeId={previewNode}
          workspace={active}
          resolveLink={resolveLink}
          onNavigate={setPreviewNode}
          onClose={() => setPreviewNode(null)}
        />
      )}
      <GraphSlot>
        {({ width, height }) =>
          showHome ? (
            <>
              <div className="absolute top-3 right-3 z-10 flex items-center gap-2">
                <Segmented
                  options={HOME_VIEW_OPTIONS}
                  value={homeView}
                  onChange={setHomeView}
                />
                {graphButtons}
              </div>
              {homeView === "fleet" ? (
                <FleetGraph
                  workspaces={workspaces}
                  graphs={cardGraphs}
                  view={view}
                  dimensions={settings.dimensions}
                  layoutEpoch={graphs.fleetEpoch}
                  width={width}
                  height={height}
                  onOpen={(ws) => {
                    setShowHome(false);
                    openWorkspace(ws);
                  }}
                />
              ) : (
                <MissionControl
                  workspaces={workspaces}
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
                  groups={groupsFor(settings, active?.id)}
                  display={view.display}
                  forces={view.forces}
                  stateRef={stateRef}
                  onNodeClick={setPreviewNode}
                  focusNode={previewNode}
                  layoutEpoch={layoutEpoch}
                  rotationPaused={previewNode !== null}
                  width={width}
                  height={height}
                />
              ) : (
                <Graph
                  graph={visible}
                  domains={domains}
                  groups={groupsFor(settings, active?.id)}
                  display={view.display}
                  forces={view.forces}
                  stateRef={stateRef}
                  onNodeClick={setPreviewNode}
                  focusNode={previewNode}
                  layoutEpoch={layoutEpoch}
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

              <Timeline
                log={(active && logsRef.current.get(active.id)) || []}
                index={replayIndex}
                onScrub={onScrub}
              />
              {/* absolute within the graph slot, not fixed to the viewport —
                so this sits at the slot's own right edge (left of the
                terminal panel, whatever its current width) instead of
                overlapping the terminal when it's open */}
              <div className="absolute top-3 right-3 z-10 flex items-center gap-2">
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
            </>
          )
        }
      </GraphSlot>
      {/* terminals live in a module-level map, so swapping which one is on
          screen costs no session and no scrollback. On a workspace it's that
          workspace's own terminal; home shows the last-opened one plus the
          fleet inbox. */}
      {(() => {
        const ws = showHome
          ? (workspaces.find((w) => w.id === focusedId) ?? null)
          : active;
        return (
          ws && (
            <TerminalPanel
              workspace={ws}
              inbox={showHome ? { workspaces, statuses } : undefined}
            />
          )
        );
      })()}
      {showSettings && (
        <GraphSettingsPanel
          settings={settings}
          activeId={active?.id ?? null}
          search={search}
          onSearchChange={setSearch}
          onSettingsChange={updateSettings}
          onResetHighlights={() => resetHighlights(stateRef.current)}
          onClose={() => setShowSettings(false)}
          showSections={active?.kind !== "code"}
        />
      )}
    </div>
  );
}
