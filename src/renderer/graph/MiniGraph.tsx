import React, { useEffect, useMemo, useRef, useState } from "react";
import type {
  GraphGroup,
  VaultGraph,
  ViewSettings,
  Workspace,
} from "../../shared/types";
import type { HighlightState } from "../session/highlight-store";
import Graph from "./Graph";
import { domainsOf } from "./domain-colors";
import { busiest, filterGraph, type GraphFilters } from "./graph-filter";
import { COLORS } from "./graph-colors";
import {
  canSnapshot,
  isStill,
  lookKey,
  snapshots,
  snapshotValid,
  type SnapshotInputs,
} from "./card-snapshot";

// A live card runs a whole force simulation, so cards show only their most
// connected neighbourhood. At thumbnail scale the rest is invisible anyway.
export const MINI_NODES = 250;
const MINI_NODE_SCALE = 1.5; // dots shrink with the fit; hubs must stay visible
const SNAPSHOT_CHECK_MS = 500;

type MiniGraphProps = {
  workspaceId: string; // keys the card's snapshot
  working: boolean; // a working card stays live, so its pulses and matches move
  graph: VaultGraph | null; // null while the workspace's graph is still loading
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
};

// A card is the 2D view, shrunk — same component, same forces, so a thumbnail
// can't drift from the view it stands for. pointer-events are off so the card
// stays one big button. A card that is not working and holds a snapshot valid
// for its graph, highlights and look shows that image; otherwise it is live,
// and captures one once it has settled and nothing is animating.
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

  // the unfiltered graph is the identity: a reload yields a new object
  const look = lookKey({ baseHue, groups, view, filters, width, height });
  const inputs = inputsOf(graph, state, look);
  const snapshot = snapshots.get(workspaceId);
  const showImage =
    !working && inputs !== undefined && snapshotValid(snapshot, inputs);

  // the check loop runs once for the card's lifetime and reads props from here
  const latest = useRef({
    workspaceId,
    working,
    graph,
    state,
    look,
    showImage,
  });
  latest.current = { workspaceId, working, graph, state, look, showImage };

  const wrapperRef = useRef<HTMLDivElement>(null);
  const settledRef = useRef(false);
  const markSettled = useRef(() => {
    settledRef.current = true;
  }).current;
  // new data restarts the simulation, so an earlier settle no longer counts
  useEffect(() => {
    settledRef.current = false;
  }, [mini]);
  // the live Graph is unmounted while the image shows, and going live re-settles
  if (showImage) settledRef.current = false;

  const [, setChecks] = useState(0);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const check = () => {
      const now = latest.current;
      const current = inputsOf(now.graph, now.state, now.look);
      if (now.showImage) {
        // the store rev moves without a re-render, so the image watches it
        if (!current || !snapshotValid(snapshots.get(now.workspaceId), current))
          setChecks((n) => n + 1);
      } else if (
        current &&
        !now.working &&
        settledRef.current &&
        isStill(now.state, performance.now())
      ) {
        const canvas = wrapperRef.current?.querySelector("canvas");
        if (canvas) {
          snapshots.set(now.workspaceId, {
            url: canvas.toDataURL(),
            inputs: current,
          });
          setChecks((n) => n + 1);
        }
      }
      timer = setTimeout(check, SNAPSHOT_CHECK_MS);
    };
    timer = setTimeout(check, SNAPSHOT_CHECK_MS);
    return () => clearTimeout(timer);
  }, []);

  // a failed, empty or loading graph keeps no image, so a later good load
  // captures afresh
  useEffect(() => {
    if (!canSnapshot(graph)) snapshots.delete(workspaceId);
  }, [graph, workspaceId]);

  return (
    <div
      ref={wrapperRef}
      className="pointer-events-none overflow-hidden rounded"
      style={{ width, height, background: COLORS.bg }}
    >
      {showImage && snapshot ? (
        <img
          src={snapshot.url}
          alt=""
          draggable={false}
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

function inputsOf(
  graph: VaultGraph | null,
  state: HighlightState,
  look: string,
): SnapshotInputs | undefined {
  return canSnapshot(graph) ? { graph, rev: state.rev, look } : undefined;
}

function noop() {
  return;
}
