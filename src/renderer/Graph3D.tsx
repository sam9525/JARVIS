import React, { useCallback, useEffect, useMemo, useRef } from "react";
import ForceGraph3D from "react-force-graph-3d";
import type { ForceGraphMethods } from "react-force-graph-3d";
import type { GraphGroup, Settings, VaultGraph } from "../shared/types";
import { nodeDisplay, type HighlightState } from "./highlight-store";
import { baseNodeColor } from "./domain-colors";
import { graphMetrics } from "./graph-metrics";
import { COLORS } from "./graph-colors";
import { useForceTuning, type ForceHandle } from "./use-force-tuning";
import SpriteText from "three-spritetext";
import { nodeLabelText } from "./node-label";

// camera distance bounds — the 3D analog of 2D's minZoom/maxZoom
const CAM = { min: 20, max: 3000 } as const;

// slider (2–30) → max camera distance at which labels show; higher threshold
// hides labels sooner, matching the 2D slider's direction. 15 → 300 units.
const LABEL_DISTANCE_SCALE = 4500;

type NodeObj = {
  id?: string | number;
  type?: string;
  domain?: string;
  r?: number;
  x?: number;
  y?: number;
  z?: number;
};

type GraphProps = {
  graph: VaultGraph; // may be filtered
  domains: string[]; // from the FULL graph — keeps palette indices stable
  groups: GraphGroup[];
  display: Settings["display"];
  forces: Settings["forces"];
  stateRef: React.MutableRefObject<HighlightState>;
  onNodeClick: (id: string) => void;
};

export default function Graph3D({
  graph,
  domains,
  groups,
  display,
  forces,
  stateRef,
  onNodeClick,
}: GraphProps) {
  const fgRef = useRef<ForceGraphMethods>();
  const didFit = useRef(false); // fit-to-screen once, not on every re-settle
  // node id → its label sprite, so the visibility sweep can toggle them.
  // Entries for removed nodes go stale but are never visited (sweep iterates
  // current data.nodes) — harmless.
  const sprites = useRef(new Map<string, SpriteText>());

  // Nodes carry the BASE radius only — display.nodeSize applies at paint time
  // so a slider tick doesn't re-bind data and restart the simulation.
  const data = useMemo(() => {
    const m = graphMetrics(graph);
    return {
      nodes: graph.nodes.map((n) => ({ ...n, r: m.radius.get(n.id) ?? 4 })),
      links: graph.edges.map((e) => ({ source: e.source, target: e.target })),
    };
  }, [graph]);

  useForceTuning(
    fgRef as unknown as React.MutableRefObject<ForceHandle | undefined>,
    forces,
  );

  useEffect(() => {
    const controls = fgRef.current?.controls() as
      { minDistance: number; maxDistance: number } | undefined;
    if (controls) {
      controls.minDistance = CAM.min;
      controls.maxDistance = CAM.max;
    }
  }, []);

  // ponytail: 3D node materials are baked, not repainted every frame like the
  // 2D canvas, so highlight changes need a nudge. Re-run the color accessors
  // 2×/s while any node is highlighted so Read flares fade and Edit marks land.
  // Ceiling: add an animating-window guard if refresh() costs too much on very
  // large vaults.
  useEffect(() => {
    const id = setInterval(() => {
      if (stateRef.current.nodes.size > 0) fgRef.current?.refresh();
    }, 500);
    return () => clearInterval(id);
  }, [stateRef]);

  // ponytail: label visibility is a 4×/s distance sweep, not per-frame
  // projection math like 2D. Ceiling: hook onEngineTick if the interval lags.
  useEffect(() => {
    const id = setInterval(() => {
      const cam = fgRef.current?.camera();
      if (!cam) return;
      const maxDist = LABEL_DISTANCE_SCALE / display.textFadeThreshold;
      const maxSq = maxDist * maxDist;
      for (const n of data.nodes as NodeObj[]) {
        const s = sprites.current.get(String(n.id));
        if (!s) continue;
        const dx = (n.x ?? 0) - cam.position.x;
        const dy = (n.y ?? 0) - cam.position.y;
        const dz = (n.z ?? 0) - cam.position.z;
        s.visible = dx * dx + dy * dy + dz * dz < maxSq;
      }
    }, 250);
    return () => clearInterval(id);
  }, [data, display.textFadeThreshold]);

  // Node size / link thickness / group colors are baked into 3D geometry, so a
  // slider change only takes effect on refresh(). Forces re-settle on their own
  // via useForceTuning's reheat. Skip the mount run — the first build already
  // reads current values. refresh() re-reads accessors without moving nodes.
  const didRefresh = useRef(false);
  useEffect(() => {
    if (!didRefresh.current) {
      didRefresh.current = true;
      return;
    }
    fgRef.current?.refresh();
  }, [display, groups]);

  const nodeThreeObject = useCallback(
    (node: NodeObj) => {
      const id = String(node.id);
      const sprite = new SpriteText(nodeLabelText(id, node.type));
      sprite.color = COLORS.label;
      sprite.textHeight = 4;
      // sit just below the sphere; re-created on refresh() so a nodeSize
      // slider change re-derives the offset
      sprite.position.set(0, -((node.r ?? 4) * display.nodeSize + 4), 0);
      // refresh() recreates sprites with visible=true; inherit the previous
      // visibility so far labels don't strobe between distance sweeps
      sprite.visible = sprites.current.get(id)?.visible ?? true;
      sprites.current.set(id, sprite);
      return sprite;
    },
    [display.nodeSize],
  );

  return (
    <ForceGraph3D
      ref={fgRef}
      graphData={data}
      backgroundColor={COLORS.bg}
      nodeResolution={16}
      cooldownTicks={200} // settle in ~1-2s instead of the default 15s so the fit fires promptly
      onEngineStop={() => {
        if (didFit.current) return;
        didFit.current = true;
        fgRef.current?.zoomToFit(200, 40);
      }}
      nodeLabel="id"
      nodeVal={(node: NodeObj) => ((node.r ?? 4) * display.nodeSize) ** 2}
      nodeThreeObjectExtend={true}
      nodeThreeObject={nodeThreeObject}
      nodeColor={(node: NodeObj) => {
        const id = String(node.id);
        // highlights always win, then group color, then domain palette
        const d = nodeDisplay(stateRef.current, id, performance.now());
        if (d) return COLORS[d];
        return baseNodeColor(
          { id, type: node.type, domain: node.domain },
          domains,
          groups,
        );
      }}
      linkColor={() => COLORS.link}
      linkWidth={() => display.linkThickness}
      onNodeClick={(node: NodeObj) => {
        if (node.type === "note") onNodeClick(String(node.id));
      }}
    />
  );
}
