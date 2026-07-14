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
  ArrowHelper,
  CanvasTexture,
  Color,
  Group,
  LineBasicMaterial,
  MeshBasicMaterial,
  Sprite,
  SpriteMaterial,
  Texture,
  Vector3,
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

// hollow white circle; tinted #ff8fab via material.color
function makeRingTexture(): CanvasTexture {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2 - 8, 0, 2 * Math.PI);
  ctx.stroke();
  return new CanvasTexture(canvas);
}

// camera distance bounds — the 3D analog of 2D's minZoom/maxZoom
const CAM = { min: 20, max: 3000 } as const;

// idle auto-rotation: resume this long after the last interaction
const IDLE_ROTATE_MS = 5000;
const ROTATE_SPEED = 0.7;

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
  focusNode: string | null; // aim the camera at this node
  layoutEpoch: number; // bumped by manual refresh — re-arm the one-time fit
  rotationPaused: boolean; // preview open — no auto-rotation
};

export default function Graph3D({
  graph,
  domains,
  groups,
  display,
  forces,
  stateRef,
  onNodeClick,
  focusNode,
  layoutEpoch,
  rotationPaused,
}: GraphProps) {
  const fgRef = useRef<ForceGraphMethods>();
  const didFit = useRef(false); // fit-to-screen once, not on every re-settle
  // node id → its label sprite, so the visibility sweep can toggle them.
  // Entries for removed nodes go stale but are never visited (sweep iterates
  // current data.nodes) — harmless.
  const sprites = useRef(new Map<string, SpriteText>());
  const pausedRef = useRef(rotationPaused);
  pausedRef.current = rotationPaused;
  const rotationCtl = useRef<{ stop: () => void; arm: () => void }>();

  // a rescan hands over brand-new node objects, so the simulation restarts
  // on its own; we only need to let onEngineStop re-fit the camera
  useEffect(() => {
    if (layoutEpoch === 0) return;
    didFit.current = false;
  }, [layoutEpoch]);

  // Nodes carry the BASE radius only — display.nodeSize applies at paint time
  // so a slider tick doesn't re-bind data and restart the simulation.
  const data = useMemo(() => {
    const m = graphMetrics(graph);
    return {
      nodes: graph.nodes.map((n) => ({ ...n, r: m.radius.get(n.id) ?? 4 })),
      links: graph.edges.map((e) => ({ source: e.source, target: e.target })),
    };
  }, [graph]);

  const nodeById = useMemo(
    () => new Map(data.nodes.map((n) => [String(n.id), n as NodeObj])),
    [data],
  );

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
      opacity: display.linkOpacity,
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
    { pad: display.haloPad, base: display.haloBase },
  );

  // read-order arrows live in a component-owned group, rebuilt by the
  // highlight interval — never part of graphData
  const trailGroup = useRef<Group>();
  useEffect(() => {
    const scene = fgRef.current?.scene();
    if (!scene) return;
    const g = new Group();
    scene.add(g);
    trailGroup.current = g;
    return () => {
      for (const c of [...g.children]) (c as ArrowHelper).dispose();
      g.clear();
      scene.remove(g);
    };
  }, []);

  // rotate the view toward the focused node without moving the camera
  useEffect(() => {
    if (!focusNode) return;
    const node = nodeById.get(focusNode);
    if (!node || node.x === undefined) return;
    const cam = fgRef.current?.camera();
    if (!cam) return;
    fgRef.current?.cameraPosition(
      { x: cam.position.x, y: cam.position.y, z: cam.position.z },
      { x: node.x ?? 0, y: node.y ?? 0, z: node.z ?? 0 },
      800,
    );
  }, [focusNode, nodeById]);

  useEffect(() => {
    const controls = fgRef.current?.controls() as
      | {
          minDistance: number;
          maxDistance: number;
          autoRotate: boolean;
          autoRotateSpeed: number;
          enableDamping: boolean;
          dampingFactor: number;
          addEventListener(type: string, fn: () => void): void;
          removeEventListener(type: string, fn: () => void): void;
        }
      | undefined;
    if (!controls) return;
    controls.minDistance = CAM.min;
    controls.maxDistance = CAM.max;
    controls.autoRotateSpeed = ROTATE_SPEED;
    // release inertia: the drag coasts and slows to a stop instead of
    // halting dead. autoRotate already animates each frame, which proves
    // controls.update() runs per frame — damping rides the same loop.
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stopRotate = () => {
      controls.autoRotate = false;
      clearTimeout(timer);
    };
    const armRotate = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (!pausedRef.current) controls.autoRotate = true;
      }, IDLE_ROTATE_MS);
    };
    controls.addEventListener("start", stopRotate); // user grabbed the camera
    controls.addEventListener("end", armRotate); // released — rotate in 5s
    armRotate(); // initial load counts as an interaction
    rotationCtl.current = { stop: stopRotate, arm: armRotate };
    linkMaterial.resolution.set(window.innerWidth, window.innerHeight);
    linkMaterial.linewidth = display.linkThickness * 2;
    return () => {
      controls.removeEventListener("start", stopRotate);
      controls.removeEventListener("end", armRotate);
      clearTimeout(timer);
    };
  }, []);

  // preview open ⇒ stop now and stay stopped; close ⇒ normal idle re-arm
  useEffect(() => {
    if (rotationPaused) rotationCtl.current?.stop();
    else rotationCtl.current?.arm();
  }, [rotationPaused]);

  // ponytail: rings/colors are baked into node objects, so poll the store's
  // rev counter and re-run accessors once per change (covers add AND reset).
  // Trail arrows rebuild every tick (cheap — dozens at most) to track drift.
  const lastRev = useRef(-1);
  useEffect(() => {
    const id = setInterval(() => {
      const s = stateRef.current;
      if (s.rev !== lastRev.current) {
        lastRev.current = s.rev;
        fgRef.current?.refresh();
      }
      const g = trailGroup.current;
      if (!g) return;
      for (const c of [...g.children]) (c as ArrowHelper).dispose();
      g.clear();
      for (let i = 0; i < s.trail.length - 1; i++) {
        const a = nodeById.get(s.trail[i]);
        const b = nodeById.get(s.trail[i + 1]);
        if (!a || !b || a.x === undefined || b.x === undefined) continue;
        const from = new Vector3(a.x ?? 0, a.y ?? 0, a.z ?? 0);
        const dir = new Vector3(b.x ?? 0, b.y ?? 0, b.z ?? 0).sub(from);
        const len = dir.length();
        if (len < 2) continue;
        const arrow = new ArrowHelper(
          dir.normalize(),
          from,
          len,
          0xff8fab, // COLORS.ring
          6,
          3,
        );
        (arrow.line.material as LineBasicMaterial).transparent = true;
        (arrow.line.material as LineBasicMaterial).opacity = 0.6;
        (arrow.cone.material as MeshBasicMaterial).transparent = true;
        (arrow.cone.material as MeshBasicMaterial).opacity = 0.6;
        g.add(arrow);
      }
    }, 500);
    return () => clearInterval(id);
  }, [stateRef, nodeById]);

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
    linkMaterial.opacity = display.linkOpacity;
    for (const m of glowMats.current.values()) m.opacity = display.nodeOpacity;
    fgRef.current?.refresh();
  }, [display, groups, linkMaterial]);

  // highlights always win, then group color, then domain palette
  const displayColor = useCallback(
    (node: NodeObj): string => {
      const id = String(node.id);
      // modified recolors the sphere; a read gets a ring sprite (Task 3)
      if (nodeDisplay(stateRef.current, id) === "modified")
        return COLORS.modified;
      return baseNodeColor(
        { id, type: node.type, domain: node.domain },
        domains,
        groups,
      );
    },
    [stateRef, domains, groups],
  );

  // glow materials are shared per color and component-owned — no-op the
  // library's flush disposals (like linkMaterial) and dispose on unmount.
  // Opacity comes through a ref so mats created after a slider change match
  // the ones the display effect already re-tinted.
  const glowTexture = useRef<CanvasTexture>();
  const glowMats = useRef(new Map<string, SpriteMaterial>());
  const glowOpacity = useRef(display.nodeOpacity);
  glowOpacity.current = display.nodeOpacity;
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
        opacity: glowOpacity.current,
        depthWrite: false,
        blending: AdditiveBlending,
      });
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      m.dispose = () => {};
      glowMats.current.set(color, m);
    }
    return m;
  }, []);

  // shared ring sprite material for read-highlighted nodes; same no-op-dispose
  // pattern as glowMaterial — the library flush-disposes node objects on
  // refresh() so a shared, component-owned material must survive that.
  const ringMat = useRef<SpriteMaterial>();
  const ringMaterial = useCallback((): SpriteMaterial => {
    if (!ringMat.current) {
      const texture = makeRingTexture();
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      texture.dispose = () => {};
      ringMat.current = new SpriteMaterial({
        map: texture,
        color: COLORS.ring,
        transparent: true,
        depthWrite: false,
      });
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      ringMat.current.dispose = () => {};
    }
    return ringMat.current;
  }, []);

  useEffect(() => {
    const mats = glowMats.current;
    const texture = glowTexture;
    return () => {
      for (const m of mats.values()) SpriteMaterial.prototype.dispose.call(m);
      mats.clear();
      if (texture.current) Texture.prototype.dispose.call(texture.current);
      if (ringMat.current) {
        if (ringMat.current.map)
          Texture.prototype.dispose.call(ringMat.current.map);
        SpriteMaterial.prototype.dispose.call(ringMat.current);
      }
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
      glow.scale.setScalar(sphereR * 4);
      obj.add(glow);
      if (nodeDisplay(stateRef.current, id) === "ring") {
        const ring = new Sprite(ringMaterial());
        ring.scale.setScalar(sphereR * 3);
        obj.add(ring);
      }
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
    [display.nodeSize, glowMaterial, displayColor, ringMaterial, stateRef],
  );

  return (
    <ForceGraph3D
      ref={fgRef}
      graphData={data}
      backgroundColor={COLORS.bg}
      controlType="orbit"
      nodeResolution={16}
      cooldownTicks={300} // settle in ~1-2s instead of the default 15s so the fit fires promptly
      onEngineStop={() => {
        if (didFit.current) return;
        didFit.current = true;
        fgRef.current?.zoomToFit(300, -400);
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
