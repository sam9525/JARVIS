import React, { useMemo, useRef } from "react";
import type {
  Dimensions,
  ViewSettings,
  VaultGraph,
  Workspace,
} from "../../shared/types";
import Graph from "./Graph";
import Graph3D from "./Graph3D";
import { emptyState } from "../session/highlight-store";
import { domainsOf } from "./domain-colors";
import { buildFleetGraph, FLEET_ROOT } from "./fleet-graph";

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
  onOpen,
}: {
  workspaces: Workspace[];
  graphs: Map<string, VaultGraph>;
  view: ViewSettings;
  dimensions: Dimensions;
  layoutEpoch: number; // bumped by ↻ so the fleet re-fits after a re-scan
  width: number;
  height: number;
  onOpen: (ws: Workspace) => void;
}) {
  const fleet = useMemo(
    () => buildFleetGraph(workspaces, graphs),
    [workspaces, graphs],
  );
  const domains = useMemo(() => domainsOf(fleet), [fleet]);
  const stateRef = useRef(emptyState());

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
      onNodeClick={onNodeClick}
      focusNode={null}
      layoutEpoch={layoutEpoch}
      width={width}
      height={height}
    />
  );
}
