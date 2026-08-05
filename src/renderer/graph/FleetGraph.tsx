import React, { useMemo, useRef } from "react";
import type {
  Dimensions,
  ViewSettings,
  VaultGraph,
  Workspace,
} from "../../shared/types";
import Graph, { type GraphHandle } from "./Graph";
import Graph3D, { type Graph3DHandle } from "./Graph3D";
import { emptyState } from "../session/highlight-store";
import { domainsOf } from "./domain-colors";
import { buildFleetGraph, FLEET_ROOT } from "./fleet-graph";
import { useHandActions, type HandActions } from "../hands/use-hand-actions";

// one light-blue backdrop for the whole fleet: a single halo whose query `::`
// matches every fleet id (all are `a::b`, `hub::x`, or `root::jarvis`), so it
// spans all nodes. Per-cluster colors mixed to white where clusters overlapped.
const FLEET_HALO_GROUPS = [{ query: "::", color: "#61afef" }];

// One merged graph of the whole fleet. Static — no live highlight layer in this
// build (the wsId:: prefix breaks the per-workspace highlight store's keys).
export default function FleetGraph({
  workspaces,
  graphs,
  view,
  dimensions,
  layoutEpoch,
  width,
  height,
  actionsRef,
  onOpen,
}: {
  workspaces: Workspace[];
  graphs: Map<string, VaultGraph>;
  view: ViewSettings;
  dimensions: Dimensions;
  layoutEpoch: number; // bumped by ↻ so the fleet re-fits after a re-scan
  width: number;
  height: number;
  actionsRef: React.MutableRefObject<HandActions>; // hand gestures land here
  onOpen: (ws: Workspace) => void;
}) {
  const fleet = useMemo(
    () => buildFleetGraph(workspaces, graphs),
    [workspaces, graphs],
  );
  const domains = useMemo(() => domainsOf(fleet), [fleet]);
  const stateRef = useRef(emptyState());
  const handle3d = useRef<Graph3DHandle | null>(null);
  const handle2d = useRef<GraphHandle | null>(null);

  // palm is the camera hand here too; the fleet has no ring to pinch, so 2D
  // pinch-drag pans the canvas and 3D registers no drag at all (design §6)
  useHandActions(
    actionsRef,
    dimensions === "3d"
      ? {
          orbit: (v) => handle3d.current?.spin(v),
          zoom: (f) => handle3d.current?.zoom(f),
        }
      : {
          drag: (dx, dy) => handle2d.current?.pan(dx, dy),
          zoom: (f) => handle2d.current?.zoom(f),
        },
  );

  // node id is `${wsId}::rest`, hub is `hub::${wsId}`, root is FLEET_ROOT
  const onNodeClick = (id: string) => {
    if (id === FLEET_ROOT) return;
    const wsId = id.startsWith("hub::")
      ? id.slice(5)
      : id.slice(0, id.indexOf("::"));
    const ws = workspaces.find((w) => w.id === wsId);
    if (ws) onOpen(ws);
  };

  return dimensions === "3d" ? (
    <Graph3D
      graph={fleet}
      domains={domains}
      groups={[]}
      haloGroups={FLEET_HALO_GROUPS}
      display={view.display}
      forces={view.forces}
      stateRef={stateRef}
      handleRef={handle3d}
      onNodeClick={onNodeClick}
      focusNode={null}
      layoutEpoch={layoutEpoch}
      rotationPaused={false}
      width={width}
      height={height}
      lite
    />
  ) : (
    <Graph
      graph={fleet}
      domains={domains}
      groups={[]}
      display={view.display}
      forces={view.forces}
      stateRef={stateRef}
      handleRef={handle2d}
      onNodeClick={onNodeClick}
      focusNode={null}
      layoutEpoch={layoutEpoch}
      width={width}
      height={height}
    />
  );
}
