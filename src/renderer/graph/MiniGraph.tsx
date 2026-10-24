import React, { useEffect, useMemo, useRef, useState } from "react";
import type {
  CardLayout,
  GraphGroup,
  VaultGraph,
  ViewSettings,
  Workspace,
} from "../../shared/types";
import {
  matchProgress,
  pulseProgress,
  type HighlightState,
} from "../session/highlight-store";
import Graph from "./Graph";
import { domainsOf } from "./domain-colors";
import { busiest, filterGraph, type GraphFilters } from "./graph-filter";
import { COLORS } from "./graph-colors";
import { paintLayout } from "./graph-paint";
import {
  canSnapshot,
  dropSnapshot,
  lookKey,
  snapshots,
  snapshotValid,
} from "./card-snapshot";

// A live card runs a whole force simulation, so cards show only their most
// connected neighbourhood. At thumbnail scale the rest is invisible anyway.
export const MINI_NODES = 250;
const MINI_NODE_SCALE = 1.5; // dots shrink with the fit; hubs must stay visible
const SNAPSHOT_CHECK_MS = 500;

type MiniGraphProps = {
  workspaceId: string; // keys the card's snapshot
  working: boolean; // a working card stays live, so its pulses and matches move
  graph: VaultGraph | null; // null until the workspace's graph is loaded
  kind: Workspace["kind"]; // code workspaces have no sections — see below
  baseHue: number; // the workspace identity hue — same one Fleet paints it with
  state: HighlightState;
  groups: GraphGroup[];
  view: ViewSettings; // always the 2D view's, even when the app is in 3D
  // the section/tag/orphan filters the workspace view uses; search is left out
  // on purpose — it belongs to the workspace you have open, not to every card
  filters: Omit<GraphFilters, "search">;
  width: number;
  height: number;
  onNeedGraph: () => void; // a card that has to go live asks for its graph
};

// A card is the 2D view, shrunk — same component, same forces, so a thumbnail
// can't drift from the view it stands for. pointer-events are off so the card
// stays one big button. A card that is not working and holds a layout stored
// for its look draws that layout, with live highlights, on a plain canvas;
// otherwise it is live, and records its layout once it has settled.
export default function MiniGraph({
  workspaceId,
  working,
  graph,
  kind,
  baseHue,
  state,
  groups,
  view,
  filters,
  width,
  height,
  onNeedGraph,
}: MiniGraphProps) {
  // Graph reads highlights through a ref so its canvas can repaint without
  // re-rendering; cards get the state by value, so mirror it into one
  const stateRef = useRef(state);
  stateRef.current = state;

  // depends on the filter FIELDS, not the object: a fresh-but-equal filters
  // object each render would hand force-graph new data and restart the settle
  const mini = useMemo(
    () =>
      graph
        ? busiest(
            filterGraph(graph, {
              // code workspaces have no sections; force "both" so nothing
              // vanishes, exactly as App does for the open workspace
              sectionFilter: kind === "code" ? "both" : filters.sectionFilter,
              search: "",
              showTags: filters.showTags,
              showOrphans: filters.showOrphans,
            }),
            MINI_NODES,
          )
        : null,
    [graph, kind, filters.sectionFilter, filters.showTags, filters.showOrphans],
  );
  const domains = useMemo(() => (mini ? domainsOf(mini) : []), [mini]);
  const display = useMemo(
    () => ({
      ...view.display,
      nodeSize: view.display.nodeSize * MINI_NODE_SCALE,
      textFadeThreshold: Infinity, // no labels on a 220px card
    }),
    [view.display],
  );

  const look = lookKey({ baseHue, groups, view, filters, width, height });
  const snapshot = snapshots.get(workspaceId);
  const showStored = !working && snapshotValid(snapshot, look);
  const dpr = window.devicePixelRatio || 1;

  // the check loop runs once for the card's lifetime and reads props from here
  const latest = useRef({
    workspaceId,
    working,
    graph,
    state,
    look,
    showStored,
    dpr,
    display,
  });
  latest.current = {
    workspaceId,
    working,
    graph,
    state,
    look,
    showStored,
    dpr,
    display,
  };

  const layoutRef = useRef<(() => CardLayout | null) | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const paintedRev = useRef<number | null>(null);
  const paintStored = useRef(() => {
    const now = latest.current;
    const s = snapshots.get(now.workspaceId);
    const ctx = canvasRef.current?.getContext("2d");
    if (!s || !ctx) return;
    paintLayout(ctx, s.layout, now.state, {
      nodeSize: now.display.nodeSize,
      linkThickness: now.display.linkThickness,
      dpr: now.dpr,
      now: performance.now(),
    });
    paintedRev.current = now.state.rev;
  }).current;
  useEffect(() => {
    if (showStored) paintStored();
  }, [showStored, snapshot, dpr, paintStored]);

  const settledRef = useRef(false);
  const markSettled = useRef(() => {
    settledRef.current = true;
  }).current;
  // new data restarts the simulation, so an earlier settle no longer counts
  useEffect(() => {
    settledRef.current = false;
  }, [mini]);
  // the live Graph is unmounted while the stored layout shows, and going live
  // re-settles
  if (showStored) settledRef.current = false;

  // a card that must go live with no graph asks once per workspace, so a
  // re-render while the load is in flight does not ask again
  const askedFor = useRef<string | null>(null);
  useEffect(() => {
    if (showStored || graph !== null || askedFor.current === workspaceId)
      return;
    askedFor.current = workspaceId;
    onNeedGraph();
  }, [showStored, graph, workspaceId, onNeedGraph]);

  const [, setChecks] = useState(0);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const check = () => {
      const now = latest.current;
      const valid = snapshotValid(snapshots.get(now.workspaceId), now.look);
      if (now.showStored) {
        const t = performance.now();
        // the store rev moves without a re-render, so the canvas watches it;
        // a dropped entry sends the card live
        if (!valid) setChecks((n) => n + 1);
        else if (
          now.state.rev !== paintedRev.current ||
          pulseProgress(now.state, t) !== null ||
          matchProgress(now.state, t) !== null
        )
          paintStored();
      } else if (
        !now.working &&
        settledRef.current &&
        canSnapshot(now.graph) &&
        !valid
      ) {
        const layout = layoutRef.current?.();
        if (layout && layout.nodes.length > 0) {
          const s = { look: now.look, layout };
          snapshots.set(now.workspaceId, s);
          window.jarvis
            .saveCardSnapshot(now.workspaceId, s)
            .catch(console.error);
          setChecks((n) => n + 1);
        }
      }
      timer = setTimeout(check, SNAPSHOT_CHECK_MS);
    };
    timer = setTimeout(check, SNAPSHOT_CHECK_MS);
    return () => clearTimeout(timer);
  }, [paintStored]);

  // a failed or empty graph keeps no layout, so a later good load records
  // afresh. A null graph only means "not loaded", so it keeps the entry.
  useEffect(() => {
    if (graph === null || canSnapshot(graph)) return;
    if (snapshots.has(workspaceId)) {
      dropSnapshot(workspaceId);
      setChecks((n) => n + 1);
    }
  }, [graph, workspaceId]);

  return (
    <div
      className="pointer-events-none overflow-hidden rounded"
      style={{ width, height, background: COLORS.bg }}
    >
      {showStored ? (
        <canvas
          ref={canvasRef}
          data-testid={`snapshot-${workspaceId}`}
          width={Math.round(width * dpr)}
          height={Math.round(height * dpr)}
          style={{ width, height, display: "block" }}
        />
      ) : (
        mini && (
          <Graph
            graph={mini}
            domains={domains}
            baseHue={baseHue}
            groups={groups}
            display={display}
            forces={view.forces}
            stateRef={stateRef}
            onNodeClick={noop}
            onSettled={markSettled}
            layoutRef={layoutRef}
            focusNode={null}
            thumbnail
            width={width}
            height={height}
          />
        )
      )}
    </div>
  );
}

function noop() {
  return;
}
