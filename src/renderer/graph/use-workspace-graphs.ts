import React, { useCallback, useEffect, useRef, useState } from "react";
import { busiest } from "./graph-filter";
import { dropSnapshot, loadStoredSnapshots, snapshots } from "./card-snapshot";
import type { IndexState } from "./EmptyGraph";
import type {
  CodeGraphLevel,
  HomeView,
  StoredSnapshot,
  VaultGraph,
  Workspace,
} from "../../shared/types";

// symbol graphs of a huge repo can be thousands of nodes; show the busiest.
// JARVIS (~386) renders uncapped.
export const SYMBOL_NODE_CAP = 600;

const EMPTY: VaultGraph = { nodes: [], edges: [] };

/** a symbol graph over the cap is trimmed to its busiest nodes; at or under it
 * passes through untouched (same object, so no needless re-layout) */
export const capped = (g: VaultGraph): VaultGraph =>
  g.nodes.length > SYMBOL_NODE_CAP ? busiest(g, SYMBOL_NODE_CAP) : g;

// a failed load is shown but never cached, so the next visit reads it again
const remember = (
  cache: Map<string, VaultGraph>,
  id: string,
  g: VaultGraph,
) => {
  if (g.failed) cache.delete(id);
  else cache.set(id, g);
};

type Params = {
  active: Workspace | null;
  activeIdRef: React.MutableRefObject<string | null>;
  codeGraphLevel: CodeGraphLevel;
  workspaces: Workspace[];
  showHome: boolean;
  homeView: HomeView;
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
  homeView,
  onWorkspacesChanged,
}: Params) {
  const [graph, setGraph] = useState<VaultGraph>(EMPTY);
  // true while a fetch is in flight, so the "no graph" notice doesn't flash
  // during the gap between clearing the graph and the fetch resolving
  const [graphLoading, setGraphLoading] = useState(false);
  const [fleetEpoch, setFleetEpoch] = useState(0); // ↻ returns the ring to the front
  const [cardGraphs, setCardGraphs] = useState(new Map<string, VaultGraph>());
  // the first card pass has finished — every workspace loaded or failed. The
  // boot entrance gates the graph slot on this rather than on `cardGraphs.size`,
  // so a fleet whose scans all come back empty still opens the slot (and the
  // "index this project" panel inside it) instead of waiting out the fallback.
  const [cardsLoaded, setCardsLoaded] = useState(false);
  // 0 until this home visit's stored layouts are in `snapshots`; each arrival
  // bumps it, which re-renders the cards against the new map
  const [storedRev, setStoredRev] = useState(0);
  // per-workspace indexing state, shared by the cards and the graph slot so
  // the two can never disagree about what a project is doing
  const [indexing, setIndexing] = useState<
    Record<string, { state: IndexState; error?: string }>
  >({});

  const fileCache = useRef(new Map<string, VaultGraph>());
  const symbolCache = useRef(new Map<string, VaultGraph>());
  // card fetches in flight, shared by the card pass and requestGraph so the
  // two never fetch one graph twice
  const cardFetches = useRef(new Map<string, Promise<VaultGraph>>());
  // ids with an entry in cardGraphs; entries are only ever replaced, never
  // removed, because a card asks for its graph once per workspace
  const cardHeld = useRef(new Set<string>());

  const putCard = useCallback((id: string, g: VaultGraph) => {
    cardHeld.current.add(id);
    setCardGraphs((prev) => new Map(prev).set(id, g));
  }, []);

  const fetchCardGraph = useCallback((id: string): Promise<VaultGraph> => {
    const cached = fileCache.current.get(id);
    if (cached) return Promise.resolve(cached);
    let pending = cardFetches.current.get(id);
    if (!pending) {
      pending = window.jarvis
        .getGraph(id)
        .then((g) => {
          remember(fileCache.current, id, g);
          return g;
        })
        .finally(() => cardFetches.current.delete(id));
      cardFetches.current.set(id, pending);
    }
    return pending;
  }, []);

  // put a freshly loaded graph on screen, but only if that workspace is still
  // the open one — a fast switch must not be overwritten by a late resolve
  const show = useCallback(
    (id: string, g: VaultGraph) => {
      if (activeIdRef.current !== id) return;
      setGraph(g);
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
        remember(cache, ws.id, g);
        if (!cancelled) show(ws.id, g);
      })
      .catch(() => setGraphLoading(false));
    return () => {
      cancelled = true;
    };
  }, [active, codeGraphLevel, show]);

  // Each home visit pulls the stored card layouts main still holds valid. An
  // unreadable list reads as empty, so every card loads its graph instead.
  useEffect(() => {
    if (!showHome) return;
    let cancelled = false;
    window.jarvis
      .getCardSnapshots()
      .catch((): StoredSnapshot[] => [])
      .then((list) => {
        if (cancelled) return;
        loadStoredSnapshots(list);
        setStoredRev((n) => n + 1);
      });
    return () => {
      cancelled = true;
      setStoredRev(0);
    };
  }, [showHome]);

  // Card graphs load in parallel, reusing whatever normal use already cached —
  // total wait is the slowest single scan, not the sum (same shape as the
  // fleet refresh below). Each card still paints as its own fetch lands.
  // Cards skip a workspace with a stored layout; Fleet and Ring draw live
  // graphs, so they load every one.
  useEffect(() => {
    if (!showHome || storedRev === 0) return;
    let cancelled = false;
    const wanted =
      homeView === "cards"
        ? workspaces.filter((ws) => !snapshots.has(ws.id))
        : workspaces;
    void Promise.all(
      wanted.map(async (ws) => {
        try {
          const g = await fetchCardGraph(ws.id);
          if (cancelled) return;
          putCard(ws.id, g);
        } catch (err) {
          // one unreadable GitNexus index must not stop the remaining cards
          // from loading — that card simply keeps its empty canvas
          console.error("card graph failed for", ws.id, err);
        }
      }),
    ).then(() => {
      if (!cancelled) setCardsLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [showHome, storedRev, homeView, workspaces, fetchCardGraph, putCard]);

  // a card that must go live asks for its graph; a failed load stays absent
  // and is not retried until the next home visit's card pass
  const requestGraph = useCallback(
    (id: string) => {
      if (cardHeld.current.has(id) || cardFetches.current.has(id)) return;
      fetchCardGraph(id)
        .then((g) => putCard(id, g))
        .catch((err) => console.error("card graph failed for", id, err));
    },
    [fetchCardGraph, putCard],
  );

  // the vault watcher pushes a rebuilt graph; cache it and show it if it's up.
  // Main deletes the stored layout on that rebuild, so the map entry goes too.
  const applyWatchedGraph = useCallback(
    (id: string, g: VaultGraph) => {
      dropSnapshot(id);
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
              dropSnapshot(ws.id);
              remember(fileCache.current, ws.id, g);
              symbolCache.current.delete(ws.id);
              return [ws.id, g] as [string, VaultGraph];
            } catch (err) {
              console.error("fleet refresh failed for", ws.id, err);
              return null;
            }
          }),
        );
        for (const r of results) if (r) cardHeld.current.add(r[0]);
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
        dropSnapshot(ws.id);
        remember(fileCache.current, ws.id, g);
        if (ws.kind === "code" && codeGraphLevel === "symbol") {
          window.jarvis
            .getSymbolGraph(ws.id)
            .then((gSym) => {
              const finalG = capped(gSym);
              remember(symbolCache.current, ws.id, finalG);
              setGraph(finalG);
              setGraphLoading(false);
            })
            .catch(console.error);
        } else {
          setGraph(g);
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
          dropSnapshot(id);
          remember(fileCache.current, id, g);
          putCard(id, g);
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
    [onWorkspacesChanged, show, putCard],
  );

  return {
    graph,
    graphLoading,
    fleetEpoch,
    cardGraphs,
    cardsLoaded,
    indexing,
    requestGraph,
    applyWatchedGraph,
    refresh,
    indexProject,
  };
}
