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
import {
  applyEvent,
  emptyState,
  resetHighlights,
  type HighlightState,
} from "./highlight-store";
import { filterGraph } from "./graph-filter";
import { domainsOf } from "./domain-colors";
import { defaultSettings } from "../shared/types";
import { createPreviewOpener } from "./preview-opener";
import type {
  Settings,
  VaultGraph,
  Workspace,
  WorkspaceStatus,
} from "../shared/types";
import { buildWikilinkResolver } from "../shared/wikilink";

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
  const [cardGraphs, setCardGraphs] = useState(new Map<string, VaultGraph>());
  // MissionControl is hook-free so it stays testable without a DOM — the
  // clock that keeps its "40s ago" honest therefore lives here.
  const [cardNow, setCardNow] = useState(() => Date.now());

  // one highlight store per workspace; Graph reads stateRef.current per frame,
  // so retargeting .current on switch is all a switch needs
  const storesRef = useRef(new Map<string, HighlightState>());
  const stateRef = useRef(emptyState());
  const activeIdRef = useRef<string | null>(null);
  const graphCacheRef = useRef(new Map<string, VaultGraph>());

  const storeFor = (id: string): HighlightState => {
    let s = storesRef.current.get(id);
    if (!s) {
      s = emptyState();
      storesRef.current.set(id, s);
    }
    return s;
  };

  // debounced auto-open: last-read file after reads go quiet
  const onPreviewEvent = useMemo(() => createPreviewOpener(setPreviewNode), []);

  const openWorkspace = useCallback(
    (ws: Workspace) => {
      onPreviewEvent.cancel(); // pending open from the old workspace must die
      setPreviewNode(null);
      setActive(ws);
      activeIdRef.current = ws.id;
      stateRef.current = storeFor(ws.id);
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
        applyEvent(storeFor(e.workspaceId), e, performance.now());
        if (e.workspaceId === activeIdRef.current) onPreviewEvent(e);
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
    window.jarvis
      .rescan(ws.id)
      .then((g) => {
        graphCacheRef.current.set(ws.id, g);
        setGraph(g);
        setLayoutEpoch((n) => n + 1);
        if (ws.kind === "code") setGraphLoading(false);
      })
      .catch(console.error);
  }, [active]);

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
        onHome={() => setShowHome(true)}
        onSelect={(ws) => {
          setShowHome(false);
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
              onSelect={(ws) => {
                setShowHome(false);
                openWorkspace(ws);
              }}
            />
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
                  <div className="absolute top-3 left-3 z-10 text-[12px] text-ink-dim">
                    no graph — GitNexus index missing or unreadable for this
                    project
                  </div>
                )}
              {/* absolute within the graph slot, not fixed to the viewport —
                so this sits at the slot's own right edge (left of the
                terminal panel, whatever its current width) instead of
                overlapping the terminal when it's open */}
              <div className="absolute top-3 right-3 z-10 flex items-center gap-2">
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
      {!showHome && active && <TerminalPanel workspace={active} />}
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
