import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Graph from "./Graph";
import Graph3D from "./Graph3D";
import GraphSlot from "./GraphSlot";
import Preview from "./Preview";
import GraphSettingsPanel from "./GraphSettingsPanel";
import WorkspaceRail from "./WorkspaceRail";
import MissionControl from "./MissionControl";
import TerminalPanel from "./TerminalPanel";
import FleetGraph from "./FleetGraph";
import HomeViewToggle, { type HomeView } from "./HomeViewToggle";
import EmptyGraph, { type IndexState } from "./EmptyGraph";
import Timeline from "./Timeline";
import GraphLevelToggle from "./GraphLevelToggle";
import { appendEvent, foldTo, nextRev } from "./replay";
import {
  applyEvent,
  emptyState,
  resetHighlights,
  type HighlightState,
} from "./highlight-store";
import { filterGraph, busiest } from "./graph-filter";
import { domainsOf } from "./domain-colors";
import { defaultSettings } from "../shared/types";
import { createPreviewOpener } from "./preview-opener";
import type {
  CodeGraphLevel,
  Settings,
  ToolEvent,
  VaultGraph,
  Workspace,
  WorkspaceStatus,
} from "../shared/types";
import { buildWikilinkResolver } from "../shared/wikilink";

// symbol graphs of a huge repo can be thousands of nodes; show the busiest.
// JARVIS (~386) renders uncapped.
const SYMBOL_NODE_CAP = 600;

export default function App() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [active, setActive] = useState<Workspace | null>(null);
  const [statuses, setStatuses] = useState<WorkspaceStatus[]>([]);
  const [graph, setGraph] = useState<VaultGraph>({ nodes: [], edges: [] });
  const [previewNode, setPreviewNode] = useState<string | null>(null);
  const [settings, setSettings] = useState<Settings>(defaultSettings());
  // Graphs mount only after settings load: swapping the forces/display prop
  // identities while react-force-graph-3d's first async graphData flush is
  // still pending reheats an engine whose layout doesn't exist yet — the
  // animation loop throws and dies, leaving a permanent black screen.
  const [settingsReady, setSettingsReady] = useState(false);
  const [search, setSearch] = useState(""); // transient — cleared on restart
  const [showSettings, setShowSettings] = useState(false);
  const [layoutEpoch, setLayoutEpoch] = useState(0);
  // true while getGraph is in flight, so the "no graph" notice doesn't flash
  // during the gap between clearing the graph and the fetch resolving
  const [graphLoading, setGraphLoading] = useState(false);
  const [showHome, setShowHome] = useState(false);
  const [homeView, setHomeView] = useState<HomeView>("cards");
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [cardGraphs, setCardGraphs] = useState(new Map<string, VaultGraph>());
  // MissionControl is hook-free so it stays testable without a DOM — the
  // clock that keeps its "40s ago" honest therefore lives here.
  const [cardNow, setCardNow] = useState(() => Date.now());

  // per-workspace indexing state, shared by the cards and the graph slot so
  // the two can never disagree about what a project is doing
  const [indexing, setIndexing] = useState<
    Record<string, { state: IndexState; error?: string }>
  >({});

  // one highlight store per workspace; Graph reads stateRef.current per frame,
  // so retargeting .current on switch is all a switch needs
  const storesRef = useRef(new Map<string, HighlightState>());
  const stateRef = useRef(emptyState());
  const activeIdRef = useRef<string | null>(null);
  const graphCacheRef = useRef(new Map<string, VaultGraph>());
  const symbolCacheRef = useRef(new Map<string, VaultGraph>());

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
      if (ws.kind === "code") {
        // the [active, codeGraphLevel] effect loads the right-level graph
        setGraph({ nodes: [], edges: [] });
        setGraphLoading(true);
        return;
      }
      const cached = graphCacheRef.current.get(ws.id);
      if (cached) {
        setGraph(cached);
        setLayoutEpoch((n) => n + 1);
        setGraphLoading(false);
      } else {
        setGraph({ nodes: [], edges: [] });
        setGraphLoading(true);
        window.jarvis.getGraph(ws.id).then((g) => {
          graphCacheRef.current.set(ws.id, g);
          if (activeIdRef.current === ws.id) {
            setGraph(g);
            setLayoutEpoch((n) => n + 1);
            setGraphLoading(false);
          }
        });
      }
    },
    [onPreviewEvent],
  );

  // A code workspace's graph is chosen by codeGraphLevel: file graph from
  // graphCacheRef (loaded here or by cards/refresh), symbol graph from
  // symbolCacheRef. Vault graphs stay owned by openWorkspace.
  useEffect(() => {
    const ws = active;
    if (!ws || ws.kind !== "code") return;
    const symbol = settings.codeGraphLevel === "symbol";
    const cache = symbol ? symbolCacheRef.current : graphCacheRef.current;
    let cancelled = false;
    const show = (g: VaultGraph) => {
      if (cancelled || activeIdRef.current !== ws.id) return;
      setGraph(g);
      setLayoutEpoch((n) => n + 1);
      setGraphLoading(false);
    };
    const cached = cache.get(ws.id);
    if (cached) {
      show(cached);
      return;
    }
    setGraphLoading(true);
    const load = symbol
      ? window.jarvis
          .getSymbolGraph(ws.id)
          .then((g) =>
            g.nodes.length > SYMBOL_NODE_CAP ? busiest(g, SYMBOL_NODE_CAP) : g,
          )
      : window.jarvis.getGraph(ws.id);
    load
      .then((g) => {
        cache.set(ws.id, g);
        show(g);
      })
      .catch(() => setGraphLoading(false));
    return () => {
      cancelled = true;
    };
  }, [active, settings.codeGraphLevel]);

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
        window.jarvis.onGraph((g) => {
          graphCacheRef.current.set(vaultId, g);
          if (activeIdRef.current === vaultId) setGraph(g);
        }),
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

  // Card graphs load one at a time, reusing whatever normal use already
  // cached. Cards render their frame and status immediately and fill in.
  useEffect(() => {
    if (!showHome) return;
    let cancelled = false;
    (async () => {
      for (const ws of workspaces) {
        if (cancelled) return;
        try {
          const cached = graphCacheRef.current.get(ws.id);
          const g = cached ?? (await window.jarvis.getGraph(ws.id));
          if (cancelled) return;
          graphCacheRef.current.set(ws.id, g);
          setCardGraphs((prev) => new Map(prev).set(ws.id, g));
        } catch (err) {
          // one unreadable GitNexus index must not stop the remaining cards
          // from loading — that card simply keeps its empty canvas
          console.error("card graph failed for", ws.id, err);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [showHome, workspaces]);

  // status pushes are the usual repaint trigger, but an all-idle fleet would
  // otherwise freeze every card's age at whatever it read when home opened
  useEffect(() => {
    if (!showHome) return;
    const id = setInterval(() => setCardNow(Date.now()), 15000);
    setCardNow(Date.now());
    return () => clearInterval(id);
  }, [showHome]);

  // re-scan the active workspace, clear highlights, and re-settle the layout;
  // settings are deliberately untouched
  const refreshGraph = useCallback(() => {
    const ws = active;
    if (!ws) return;
    resetHighlights(stateRef.current);
    symbolCacheRef.current.delete(ws.id);
    window.jarvis
      .rescan(ws.id)
      .then((g) => {
        graphCacheRef.current.set(ws.id, g);
        if (ws.kind === "code" && settings.codeGraphLevel === "symbol") {
          window.jarvis
            .getSymbolGraph(ws.id)
            .then((gSym) => {
              const finalG =
                gSym.nodes.length > SYMBOL_NODE_CAP
                  ? busiest(gSym, SYMBOL_NODE_CAP)
                  : gSym;
              symbolCacheRef.current.set(ws.id, finalG);
              setGraph(finalG);
              setLayoutEpoch((n) => n + 1);
              setGraphLoading(false);
            })
            .catch(console.error);
        } else {
          setGraph(g);
          setLayoutEpoch((n) => n + 1);
          if (ws.kind === "code") setGraphLoading(false);
        }
      })
      .catch(console.error);
  }, [active, settings.codeGraphLevel]);

  const addProject = useCallback(() => {
    window.jarvis.addProject().then(setWorkspaces).catch(console.error);
  }, []);

  const indexProject = useCallback((id: string) => {
    setIndexing((prev) => ({ ...prev, [id]: { state: "running" } }));
    window.jarvis
      .indexProject(id)
      .then(async (res) => {
        if (!res.ok) {
          setIndexing((prev) => ({
            ...prev,
            [id]: { state: "error", error: res.error },
          }));
          return;
        }
        // analyze may have changed the registered name, so refresh the list
        // before pulling the graph the rail and cards will render
        setWorkspaces(await window.jarvis.getWorkspaces());
        const g = await window.jarvis.rescan(id);
        graphCacheRef.current.set(id, g);
        setCardGraphs((prev) => new Map(prev).set(id, g));
        if (activeIdRef.current === id) {
          setGraph(g);
          setLayoutEpoch((n) => n + 1);
          setGraphLoading(false);
        }
        setIndexing((prev) => {
          const next = { ...prev };
          delete next[id]; // back to idle; an empty graph means analyze found nothing
          return next;
        });
      })
      .catch((err) => {
        setIndexing((prev) => ({
          ...prev,
          [id]: { state: "error", error: String(err) },
        }));
      });
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
          setShowHome(true);
          setFocusedId(ws.id);
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
              <div className="absolute top-3 right-3 z-10">
                <HomeViewToggle value={homeView} onChange={setHomeView} />
              </div>
              {homeView === "fleet" ? (
                <FleetGraph
                  workspaces={workspaces}
                  graphs={cardGraphs}
                  view={settings.views["2d"]}
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
                  onIndex={indexProject}
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
                  groups={settings.groups}
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
                  groups={settings.groups}
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
                      onIndex={() => indexProject(active.id)}
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
                {active && (
                  <GraphLevelToggle
                    kind={active.kind}
                    value={settings.codeGraphLevel}
                    onChange={(codeGraphLevel: CodeGraphLevel) =>
                      updateSettings({ ...settings, codeGraphLevel })
                    }
                  />
                )}
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
              </div>
            </>
          )
        }
      </GraphSlot>
      {/* terminals live in a module-level map, so unmounting here costs no
          session and no scrollback — it only takes the tab off the home screen */}
      {showHome &&
        (() => {
          const focused = workspaces.find((w) => w.id === focusedId) ?? null;
          return (
            focused && (
              <TerminalPanel
                workspace={focused}
                workspaces={workspaces}
                statuses={statuses}
                onSelectWorkspace={(ws) => setFocusedId(ws.id)}
              />
            )
          );
        })()}
      {showSettings && (
        <GraphSettingsPanel
          settings={settings}
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
