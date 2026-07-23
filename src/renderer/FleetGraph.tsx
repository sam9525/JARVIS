import React, { useMemo, useRef } from "react";
import type { ViewSettings, VaultGraph, Workspace } from "../shared/types";
import Graph from "./Graph";
import { emptyState } from "./highlight-store";
import { domainsOf } from "./domain-colors";
import { buildFleetGraph, FLEET_ROOT } from "./fleet-graph";

// One merged graph of the whole fleet. Static — no live highlight layer in this
// build (the wsId:: prefix breaks the per-workspace highlight store's keys).
export default function FleetGraph({
  workspaces,
  graphs,
  view,
  width,
  height,
  onOpen,
}: {
  workspaces: Workspace[];
  graphs: Map<string, VaultGraph>;
  view: ViewSettings;
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
    const wsId = id.startsWith("hub::") ? id.slice(5) : id.slice(0, id.indexOf("::"));
    const ws = workspaces.find((w) => w.id === wsId);
    if (ws) onOpen(ws);
  };

  return (
    <Graph
      graph={fleet}
      domains={domains}
      groups={[]}
      display={view.display}
      forces={view.forces}
      stateRef={stateRef}
      onNodeClick={onNodeClick}
      focusNode={null}
      layoutEpoch={0}
      width={width}
      height={height}
    />
  );
}
