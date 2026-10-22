import React, { useMemo, useRef } from "react";
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

// A whole force simulation per card, so cards show only their most connected
// neighbourhood. At thumbnail scale the rest is invisible anyway.
export const MINI_NODES = 250;
const MINI_NODE_SCALE = 1.5; // dots shrink with the fit; hubs must stay visible

type MiniGraphProps = {
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
// stays one big button.
export default function MiniGraph({
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

  return (
    <div
      className="pointer-events-none overflow-hidden rounded"
      style={{ width, height, background: COLORS.bg }}
    >
      {mini && (
        <Graph
          graph={mini}
          domains={domains}
          baseHue={baseHue}
          groups={groups}
          display={display}
          forces={view.forces}
          stateRef={stateRef}
          onNodeClick={noop}
          focusNode={null}
          thumbnail
          width={width}
          height={height}
        />
      )}
    </div>
  );
}

function noop() {
  return;
}
