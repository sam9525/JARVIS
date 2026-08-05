import React, { useCallback, useEffect, useRef, useState } from "react";
import { busiest } from "./graph-filter";
import type { IndexState } from "./EmptyGraph";
import type { CodeGraphLevel, VaultGraph, Workspace } from "../../shared/types";

// symbol graphs of a huge repo can be thousands of nodes; show the busiest.
// JARVIS (~386) renders uncapped.
export const SYMBOL_NODE_CAP = 600;

const EMPTY: VaultGraph = { nodes: [], edges: [] };

/** a symbol graph over the cap is trimmed to its busiest nodes; at or under it
 * passes through untouched (same object, so no needless re-layout) */
export const capped = (g: VaultGraph): VaultGraph =>
  g.nodes.length > SYMBOL_NODE_CAP ? busiest(g, SYMBOL_NODE_CAP) : g;

type Params = {
  active: Workspace | null;
  activeIdRef: React.MutableRefObject<string | null>;
  codeGraphLevel: CodeGraphLevel;
  workspaces: Workspace[];
  showHome: boolean;
  /** index-project can rename a workspace, so the list has to be re-pulled */
  onWorkspacesChanged: (list: Workspace[]) => void;
};

/**
 * Everything about WHICH graph is on screen and where it is cached: the open
 * workspace's graph, the mission-control card graphs, rescans, and gitnexus
 * indexing. File and symbol graphs get independent caches so opening the symbol
 * view never evicts the file graph the rail, cards and preview rely on.
 */
export function useWorkspaceGraphs({
  active,
  activeIdRef,
  codeGraphLevel,
  workspaces,
  showHome,
  onWorkspacesChanged,
}: Params) {
  const [graph, setGraph] = useState<VaultGraph>(EMPTY);
  // true while a fetch is in flight, so the "no graph" notice doesn't flash
  // during the gap between clearing the graph and the fetch resolving
  const [graphLoading, setGraphLoading] = useState(false);
  const [layoutEpoch, setLayoutEpoch] = useState(0);
  const [fleetEpoch, setFleetEpoch] = useState(0); // ↻ re-fits the fleet graph
  const [cardGraphs, setCardGraphs] = useState(new Map<string, VaultGraph>());
  // per-workspace indexing state, shared by the cards and the graph slot so
  // the two can never disagree about what a project is doing
  const [indexing, setIndexing] = useState<
    Record<string, { state: IndexState; error?: string }>
  >({});

  const fileCache = useRef(new Map<string, VaultGraph>());
  const symbolCache = useRef(new Map<string, VaultGraph>());

  // put a freshly loaded graph on screen, but only if that workspace is still
  // the open one — a fast switch must not be overwritten by a late resolve
  const show = useCallback(
    (id: string, g: VaultGraph) => {
      if (activeIdRef.current !== id) return;
      setGraph(g);
      setLayoutEpoch((n) => n + 1);
      setGraphLoading(false);
    },
    [activeIdRef],
  );

  useEffect(() => {
    const ws = active;
    if (!ws) return;
    const symbol = ws.kind === "code" && codeGraphLevel === "symbol";
    const cache = symbol ? symbolCache.current : fileCache.current;
    let cancelled = false;
    const cached = cache.get(ws.id);
    if (cached) {
      show(ws.id, cached);
      return;
    }
    setGraph(EMPTY);
    setGraphLoading(true);
    const load = symbol
      ? window.jarvis.getSymbolGraph(ws.id).then(capped)
      : window.jarvis.getGraph(ws.id);
    load
      .then((g) => {
        cache.set(ws.id, g);
        if (!cancelled) show(ws.id, g);
      })
      .catch(() => setGraphLoading(false));
    return () => {
      cancelled = true;
    };
  }, [active, codeGraphLevel, show]);

  // Card graphs load in parallel, reusing whatever normal use already cached —
  // total wait is the slowest single scan, not the sum (same shape as the
  // fleet refresh below). Each card still paints as its own fetch lands.
  useEffect(() => {
    if (!showHome) return;
    let cancelled = false;
    void Promise.all(
      workspaces.map(async (ws) => {
        try {
          const cached = fileCache.current.get(ws.id);
          const g = cached ?? (await window.jarvis.getGraph(ws.id));
          if (cancelled) return;
          fileCache.current.set(ws.id, g);
          setCardGraphs((prev) => new Map(prev).set(ws.id, g));
        } catch (err) {
          // one unreadable GitNexus index must not stop the remaining cards
          // from loading — that card simply keeps its empty canvas
          console.error("card graph failed for", ws.id, err);
        }
      }),
    );
    return () => {
      cancelled = true;
    };
  }, [showHome, workspaces]);

  // the vault watcher pushes a rebuilt graph; cache it and show it if it's up
  const applyWatchedGraph = useCallback(
    (id: string, g: VaultGraph) => {
      fileCache.current.set(id, g);
      if (activeIdRef.current === id) setGraph(g);
    },
    [activeIdRef],
  );

  // re-scan and re-settle: the whole fleet on the command center, otherwise
  // just the open workspace
  const refresh = useCallback(() => {
    if (showHome) {
      // ponytail: rescan the fleet in parallel so the wait is the slowest
      // single scan, not the sum. N gitnexus spawns at once is fine for a
      // handful of workspaces; throttle if a fleet ever grows large enough
      (async () => {
        const results = await Promise.all(
          workspaces.map(async (ws) => {
            try {
              const g = await window.jarvis.rescan(ws.id);
              fileCache.current.set(ws.id, g);
              symbolCache.current.delete(ws.id);
              return [ws.id, g] as [string, VaultGraph];
            } catch (err) {
              console.error("fleet refresh failed for", ws.id, err);
              return null;
            }
          }),
        );
        setCardGraphs((prev) => {
          const m = new Map(prev);
          for (const r of results) if (r) m.set(r[0], r[1]);
          return m;
        });
        setFleetEpoch((n) => n + 1);
      })();
      return;
    }
    const ws = active;
    if (!ws) return;
    symbolCache.current.delete(ws.id);
    window.jarvis
      .rescan(ws.id)
      .then((g) => {
        fileCache.current.set(ws.id, g);
        if (ws.kind === "code" && codeGraphLevel === "symbol") {
          window.jarvis
            .getSymbolGraph(ws.id)
            .then((gSym) => {
              const finalG = capped(gSym);
              symbolCache.current.set(ws.id, finalG);
              setGraph(finalG);
              setLayoutEpoch((n) => n + 1);
              setGraphLoading(false);
            })
            .catch(console.error);
        } else {
          setGraph(g);
          setLayoutEpoch((n) => n + 1);
          setGraphLoading(false);
        }
      })
      .catch(console.error);
  }, [showHome, workspaces, active, codeGraphLevel]);

  const indexProject = useCallback(
    (id: string) => {
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
          onWorkspacesChanged(await window.jarvis.getWorkspaces());
          const g = await window.jarvis.rescan(id);
          fileCache.current.set(id, g);
          setCardGraphs((prev) => new Map(prev).set(id, g));
          show(id, g);
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
    },
    [onWorkspacesChanged, show],
  );

  return {
    graph,
    graphLoading,
    layoutEpoch,
    fleetEpoch,
    cardGraphs,
    indexing,
    applyWatchedGraph,
    refresh,
    indexProject,
  };
}
