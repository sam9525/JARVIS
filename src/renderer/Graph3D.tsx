import React, { useCallback, useEffect, useMemo, useRef } from "react";
import ForceGraph3D from "react-force-graph-3d";
import type { ForceGraphMethods } from "react-force-graph-3d";
import type { GraphGroup, Settings, VaultGraph } from "../shared/types";
import { nodeDisplay, type HighlightState } from "./highlight-store";
import { baseNodeColor } from "./domain-colors";
import { graphMetrics } from "./graph-metrics";
import { COLORS } from "./graph-colors";
import { useForceTuning, type ForceHandle } from "./use-force-tuning";
import { useGroupHalos, type HaloSceneHandle } from "./use-group-halos";
import SpriteText from "three-spritetext";
import { nodeLabelText } from "./node-label";
import {
  AdditiveBlending,
  CanvasTexture,
  Color,
  Group,
  Sprite,
  SpriteMaterial,
  Texture,
} from "three";
import { Line2 } from "three/examples/jsm/lines/Line2.js";
import { LineGeometry } from "three/examples/jsm/lines/LineGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";

// links hold node objects after graph init but raw ids before it
const endpointId = (end: LinkEnd | undefined): string =>
  typeof end === "object" && end !== null ? String(end.id) : String(end);

// white radial falloff shared by every node glow sprite; tinted per node
// via material.color so one texture serves all colors
function makeGlowTexture(): CanvasTexture {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
  const g = ctx.createRadialGradient(
    size / 2,
    size / 2,
    0,
    size / 2,
    size / 2,
    size / 2,
  );
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.4, "rgba(255,255,255,0.35)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return new CanvasTexture(canvas);
}

// camera distance bounds — the 3D analog of 2D's minZoom/maxZoom
const CAM = { min: 20, max: 3000 } as const;

// idle auto-rotation: resume this long after the last interaction
const IDLE_ROTATE_MS = 5000;
const ROTATE_SPEED = 0.4;

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

type LinkEnd = string | number | NodeObj;
type LinkObj = { source?: LinkEnd; target?: LinkEnd };
type Coords = { x: number; y: number; z: number };

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

  // node id → base color so every link is a source→target gradient;
  // same-group links come out solid, cross-group links blend group colors.
  // baseNodeColor excludes highlight state so read flares don't recolor edges.
  const linkColors = useMemo(() => {
    const m = new Map<string, string>();
    for (const n of graph.nodes) m.set(n.id, baseNodeColor(n, domains, groups));
    return m;
  }, [graph, domains, groups]);

  // one material shared by every link line; linewidth is screen-space px.
  // refresh() flush-disposes each link object's material, but this one is
  // shared and component-owned — no-op those disposals (they'd force a
  // shader recompile 2×/s during highlights) and do the real one on unmount.
  const linkMaterial = useMemo(() => {
    const m = new LineMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.35,
    });
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    m.dispose = () => {};
    return m;
  }, []);

  useEffect(
    () => () => LineMaterial.prototype.dispose.call(linkMaterial),
    [linkMaterial],
  );

  const linkThreeObject = useCallback(
    (link: LinkObj) => {
      const geometry = new LineGeometry();
      // seed real endpoint positions when nodes are already resolved so a
      // refresh() at rest doesn't leave lines collapsed at the origin
      const s = typeof link.source === "object" ? link.source : undefined;
      const t = typeof link.target === "object" ? link.target : undefined;
      geometry.setPositions([
        s?.x ?? 0,
        s?.y ?? 0,
        s?.z ?? 0,
        t?.x ?? 0,
        t?.y ?? 0,
        t?.z ?? 0,
      ]);
      const sc = new Color(
        linkColors.get(endpointId(link.source)) ?? COLORS.link,
      );
      const tc = new Color(
        linkColors.get(endpointId(link.target)) ?? COLORS.link,
      );
      geometry.setColors([sc.r, sc.g, sc.b, tc.r, tc.g, tc.b]);
      return new Line2(geometry, linkMaterial);
    },
    [linkColors, linkMaterial],
  );

  useForceTuning(
    fgRef as unknown as React.MutableRefObject<ForceHandle | undefined>,
    forces,
  );

  useGroupHalos(
    fgRef as unknown as React.MutableRefObject<HaloSceneHandle | undefined>,
    data.nodes,
    groups,
  );

  useEffect(() => {
    const controls = fgRef.current?.controls() as
      | {
          minDistance: number;
          maxDistance: number;
          autoRotate: boolean;
          autoRotateSpeed: number;
          addEventListener(type: string, fn: () => void): void;
          removeEventListener(type: string, fn: () => void): void;
        }
      | undefined;
    if (!controls) return;
    controls.minDistance = CAM.min;
    controls.maxDistance = CAM.max;
    controls.autoRotateSpeed = ROTATE_SPEED;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stopRotate = () => {
      controls.autoRotate = false;
      clearTimeout(timer);
    };
    const armRotate = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        controls.autoRotate = true;
      }, IDLE_ROTATE_MS);
    };
    controls.addEventListener("start", stopRotate); // user grabbed the camera
    controls.addEventListener("end", armRotate); // released — rotate in 5s
    armRotate(); // initial load counts as an interaction
    linkMaterial.resolution.set(window.innerWidth, window.innerHeight);
    linkMaterial.linewidth = display.linkThickness * 2;
    return () => {
      controls.removeEventListener("start", stopRotate);
      controls.removeEventListener("end", armRotate);
      clearTimeout(timer);
    };
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
    linkMaterial.linewidth = display.linkThickness * 2;
    fgRef.current?.refresh();
  }, [display, groups, linkMaterial]);

  // highlights always win, then group color, then domain palette
  const displayColor = useCallback(
    (node: NodeObj): string => {
      const id = String(node.id);
      const d = nodeDisplay(stateRef.current, id, performance.now());
      if (d) return COLORS[d];
      return baseNodeColor(
        { id, type: node.type, domain: node.domain },
        domains,
        groups,
      );
    },
    [stateRef, domains, groups],
  );

  // glow materials are shared per color and component-owned — no-op the
  // library's flush disposals (like linkMaterial) and dispose on unmount
  const glowTexture = useRef<CanvasTexture>();
  const glowMats = useRef(new Map<string, SpriteMaterial>());
  const glowMaterial = useCallback((color: string): SpriteMaterial => {
    if (!glowTexture.current) {
      glowTexture.current = makeGlowTexture();
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      glowTexture.current.dispose = () => {};
    }
    let m = glowMats.current.get(color);
    if (!m) {
      m = new SpriteMaterial({
        map: glowTexture.current,
        color,
        transparent: true,
        opacity: 0.6,
        depthWrite: false,
        blending: AdditiveBlending,
      });
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      m.dispose = () => {};
      glowMats.current.set(color, m);
    }
    return m;
  }, []);

  useEffect(() => {
    const mats = glowMats.current;
    const texture = glowTexture;
    return () => {
      for (const m of mats.values()) SpriteMaterial.prototype.dispose.call(m);
      mats.clear();
      if (texture.current) Texture.prototype.dispose.call(texture.current);
    };
  }, []);

  const nodeThreeObject = useCallback(
    (node: NodeObj) => {
      const id = String(node.id);
      const obj = new Group();
      // soft radial "box shadow" behind the sphere, in the node's color;
      // sphere radius matches the lib's nodeRelSize(4) * nodeVal^(1/3)
      const sphereR = 4 * Math.cbrt(((node.r ?? 4) * display.nodeSize) ** 2);
      const glow = new Sprite(glowMaterial(displayColor(node)));
      glow.scale.setScalar(sphereR * 5);
      obj.add(glow);
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
      obj.add(sprite as unknown as Sprite);
      return obj;
    },
    [display.nodeSize, glowMaterial, displayColor],
  );

  return (
    <ForceGraph3D
      ref={fgRef}
      graphData={data}
      backgroundColor={COLORS.bg}
      controlType="orbit"
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
      nodeColor={displayColor}
      linkThreeObject={linkThreeObject}
      linkPositionUpdate={(
        obj: Line2,
        ends: { start: Coords; end: Coords },
      ) => {
        obj.geometry.setPositions([
          ends.start.x,
          ends.start.y,
          ends.start.z,
          ends.end.x,
          ends.end.y,
          ends.end.z,
        ]);
        return true; // we own positioning — skip the default handler
      }}
      onNodeClick={(node: NodeObj) => {
        if (node.type === "note") onNodeClick(String(node.id));
      }}
    />
  );
}
