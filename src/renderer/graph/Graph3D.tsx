import React, { useCallback, useEffect, useMemo, useRef } from "react";
import ForceGraph3D from "react-force-graph-3d";
import type { ForceGraphMethods } from "react-force-graph-3d";
import type { GraphGroup, ViewSettings, VaultGraph } from "../../shared/types";
import {
  expireMatches,
  heatOf,
  hlKey,
  matchProgress,
  nodeDisplay,
  type HighlightState,
} from "../session/highlight-store";
import { baseNodeColor } from "./domain-colors";
import { displayRadius, graphMetrics, sphereRadius } from "./graph-metrics";
import { brighten, COLORS } from "./graph-colors";
import { useForceTuning, type ForceHandle } from "./use-force-tuning";
import { useGroupHalos, type HaloSceneHandle } from "./use-group-halos";
import { useSpriteMaterials } from "./sprite-materials";
import { useMergedLinks } from "./use-merged-links";
import { endId, type LinkObj, type NodeObj } from "./link-ends";
import { clampSpin, decaySpin, SPIN_PER_RAD_S } from "./spin";
import SpriteText from "three-spritetext";
import { nodeLabelText } from "./node-label";
import {
  ArrowHelper,
  Color,
  Group,
  LineBasicMaterial,
  MeshBasicMaterial,
  Sprite,
  Vector3,
} from "three";
import { Line2 } from "three/examples/jsm/lines/Line2.js";
import { LineGeometry } from "three/examples/jsm/lines/LineGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";

// camera distance bounds — the 3D analog of 2D's minZoom/maxZoom
const CAM = { min: 20, max: 3000 } as const;

// idle auto-rotation: resume this long after the last interaction
const IDLE_ROTATE_MS = 5000;
const ROTATE_SPEED = 1;

// slider (2–30) → max camera distance at which labels show; higher threshold
// hides labels sooner, matching the 2D slider's direction. 15 → 300 units.
const LABEL_DISTANCE_SCALE = 4500;

type NodeAdornment = {
  group: Group;
  glow: Sprite;
  readRing: Sprite;
  matchRing: Sprite;
  focusRing: Sprite;
  label: SpriteText;
};

type Coords = { x: number; y: number; z: number };

export type Graph3DHandle = {
  spin(v: number): void; // engine rad/s — a fresh throw of the flywheel
  zoom(factor: number): void; // per-frame ratio; >1 moves the camera closer
};

// ArrowHelper owns a line + cone material apiece and nothing else disposes
// them, so emptying the trail group has to walk them by hand.
function clearTrail(group: Group): void {
  for (const child of [...group.children]) {
    const arrow = child as ArrowHelper;
    for (const part of [arrow.line, arrow.cone]) {
      const mat = part?.material;
      if (!mat) continue;
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else mat.dispose();
    }
  }
  group.clear();
}

type GraphProps = {
  graph: VaultGraph; // may be filtered
  domains: string[]; // from the FULL graph — keeps palette indices stable
  groups: GraphGroup[];
  haloGroups?: GraphGroup[]; // group halos only; decoupled from node coloring (fleet: blue backdrops over per-project node colors)
  display: ViewSettings["display"];
  forces: ViewSettings["forces"];
  stateRef: React.MutableRefObject<HighlightState>;
  onNodeClick: (id: string) => void;
  focusNode: string | null; // aim the camera at this node
  layoutEpoch: number; // bumped by manual refresh — re-arm the one-time fit
  rotationPaused: boolean; // preview open — no auto-rotation
  width: number; // measured graph-slot size from GraphSlot's ResizeObserver
  height: number;
  lite?: boolean; // static fleet view: cheaper spheres, merged link layer, normal-blend glow, no highlight polling
  handleRef?: React.MutableRefObject<Graph3DHandle | null>;
};

export default function Graph3D({
  graph,
  domains,
  groups,
  haloGroups,
  display,
  forces,
  stateRef,
  onNodeClick,
  focusNode,
  layoutEpoch,
  rotationPaused,
  width,
  height,
  lite = false,
  handleRef,
}: GraphProps) {
  const fgRef = useRef<ForceGraphMethods>();
  const didFit = useRef(false); // fit-to-screen once, not on every re-settle
  // node id → its label sprite, so the visibility sweep can toggle them.
  // Entries for removed nodes go stale but are never visited (sweep iterates
  // current data.nodes) — harmless.
  const sprites = useRef(new Map<string, SpriteText>());
  const nodeAdornments = useRef(new Map<string, NodeAdornment>());
  const pausedRef = useRef(rotationPaused);
  pausedRef.current = rotationPaused;
  const rotationCtl = useRef<{ stop: () => void; arm: () => void }>();

  // palm-orbit flywheel: throw, coast, stop. Runs its own rAF only while
  // spinning — controls.update() rides react-force-graph's internal loop,
  // which exposes no per-frame hook of ours to borrow (design §5).
  //
  // Holds the throw (v0) and its timestamp (t0), not a running speed: the
  // coast is a closed form of wall-clock elapsed, so it reaches rest at the
  // same moment however few frames arrive. Compounding a decay per tick would
  // instead measure the coast in frames, stretching it whenever the loop is
  // starved — which is precisely when a heavy spin is on screen.
  const spinState = useRef<{ v0: number; t0: number; raf: number } | null>(
    null,
  );

  const orbitControls = () =>
    fgRef.current?.controls() as
      | { autoRotate: boolean; autoRotateSpeed: number; target: Vector3 }
      | undefined;

  const stopSpinLoop = useCallback(() => {
    if (spinState.current) {
      cancelAnimationFrame(spinState.current.raf);
      spinState.current = null;
    }
  }, []);

  const spinTick = useCallback((now: number) => {
    const s = spinState.current;
    const controls = orbitControls();
    if (!s) return;
    // no controls this frame: drop the state rather than leaving it holding a
    // dead rAF id, which would send every later spin() down the reuse branch
    if (!controls) {
      spinState.current = null;
      return;
    }
    const v = decaySpin(s.v0, (now - s.t0) / 1000);
    if (v === 0) {
      // rest: hand the camera back exactly like a mouse drag ending —
      // restore the ambient speed, stop, re-arm the idle timer (which
      // consults pausedRef, so a paused graph stays still)
      controls.autoRotateSpeed = ROTATE_SPEED;
      controls.autoRotate = false;
      rotationCtl.current?.arm();
      spinState.current = null;
      return;
    }
    controls.autoRotateSpeed = v;
    s.raf = requestAnimationFrame(spinTick);
  }, []);

  const spin = useCallback(
    (v: number) => {
      const controls = orbitControls();
      if (!controls) return;
      rotationCtl.current?.stop(); // explicit input outranks the idle drift
      const speed = clampSpin(v * SPIN_PER_RAD_S);
      if (speed === 0) return;
      const now = performance.now();
      const current = spinState.current
        ? decaySpin(spinState.current.v0, (now - spinState.current.t0) / 1000)
        : 0;
      if (
        current !== 0 &&
        Math.sign(speed) === Math.sign(current) &&
        Math.abs(speed) <= Math.abs(current)
      ) {
        controls.autoRotateSpeed = current;
        return;
      }
      controls.autoRotate = true;
      controls.autoRotateSpeed = speed;
      // a fresh throw restarts the clock, coasting from the new speed
      if (spinState.current) {
        spinState.current.v0 = speed;
        spinState.current.t0 = now;
      } else {
        spinState.current = { v0: speed, t0: now, raf: 0 };
        spinState.current.raf = requestAnimationFrame(spinTick);
      }
    },
    [spinTick],
  );

  const zoomBy = useCallback((factor: number) => {
    const cam = fgRef.current?.camera();
    const controls = orbitControls();
    // `!(factor > 0)` also rejects NaN, which fails every comparison and would
    // otherwise reach cam.position.set — an unrecoverable camera
    if (!cam || !controls || !(factor > 0)) return;
    const t = controls.target;
    const dx = cam.position.x - t.x;
    const dy = cam.position.y - t.y;
    const dz = cam.position.z - t.z;
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-6) return;
    // factor > 1 zooms in: shrink the camera→target distance, same clamp as
    // the 2D view's minZoom/maxZoom analog
    const next = Math.min(CAM.max, Math.max(CAM.min, len / factor));
    const s = next / len;
    cam.position.set(t.x + dx * s, t.y + dy * s, t.z + dz * s);
  }, []);

  // [] deps: handleRef must keep a stable identity across renders — a caller
  // handing over a fresh ref each render would never be re-published to.
  // MUST stay declared above the rotationCtl effect below: cleanups run in
  // declaration order, and a rest-path arm() running after that effect's
  // clearTimeout would leak one 5s timer per ring settle.
  useEffect(() => {
    if (handleRef) handleRef.current = { spin, zoom: zoomBy };
    return () => {
      if (handleRef) handleRef.current = null;
      stopSpinLoop(); // the ring remounts per settle — never leak a loop
    };
  }, []);

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

  // lite (fleet) merged lines get their own material: depthWrite off so the
  // link layer can't punch the depth buffer and sit over the node spheres
  // (the spheres still occlude lines behind them — depthTest stays on).
  const liteLinkMaterial = useMemo(() => {
    const m = new LineMaterial({
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      opacity: display.linkOpacity,
      linewidth: display.linkThickness * 2,
    });
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    m.dispose = () => {};
    return m;
  }, []);
  useEffect(
    () => () => LineMaterial.prototype.dispose.call(liteLinkMaterial),
    [liteLinkMaterial],
  );

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
      const sc = new Color(linkColors.get(endId(link.source)) ?? COLORS.link);
      const tc = new Color(linkColors.get(endId(link.target)) ?? COLORS.link);
      geometry.setColors([sc.r, sc.g, sc.b, tc.r, tc.g, tc.b]);
      return new Line2(geometry, linkMaterial);
    },
    [linkColors, linkMaterial],
  );

  const writeMergedPositions = useMergedLinks(
    fgRef as unknown as React.MutableRefObject<
      { scene(): { add(o: object): void; remove(o: object): void } } | undefined
    >,
    lite,
    data.links,
    nodeById,
    linkColors,
    liteLinkMaterial,
    display.nodeSize,
  );

  useForceTuning(
    fgRef as unknown as React.MutableRefObject<ForceHandle | undefined>,
    forces,
  );

  useGroupHalos(
    fgRef as unknown as React.MutableRefObject<HaloSceneHandle | undefined>,
    data.nodes,
    haloGroups ?? groups,
    {
      // fleet gets one big backdrop: widen the single halo well past the graph
      pad: lite ? display.haloPad * 2.5 : display.haloPad,
      base: display.haloBase,
      opacity: display.haloOpacity,
    },
  );

  const materials = useSpriteMaterials(lite, display.nodeOpacity);

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
      clearTrail(g);
      scene.remove(g);
    };
  }, []);

  // fly the camera to focusZoom units from the focused node, looking at a
  // point shifted left of it so the node lands in the visible area right of
  // the left-docked preview card (3D analog of 2D's panel/2 centerAt offset);
  // closing the preview returns to the launch fit. focusZoom in the deps
  // makes slider drags re-apply live while a note is open.
  const hadFocus = useRef(false);
  useEffect(() => {
    if (!focusNode) {
      if (hadFocus.current) {
        hadFocus.current = false;
        fgRef.current?.zoomToFit(1000, -400);
      }
      return;
    }
    hadFocus.current = true;
    const node = nodeById.get(focusNode);
    if (!node || node.x === undefined) return;
    const cam = fgRef.current?.camera();
    if (!cam) return;
    const nx = node.x ?? 0;
    const ny = node.y ?? 0;
    const nz = node.z ?? 0;
    const dx = cam.position.x - nx;
    const dy = cam.position.y - ny;
    const dz = cam.position.z - nz;
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-6) return; // camera already on the node — nothing sensible to do
    const s = display.focusZoom / len;
    // preview is a layout sibling now, so the slot already excludes it —
    // look straight at the node with no camera-right screen-space offset
    fgRef.current?.cameraPosition(
      { x: nx + dx * s, y: ny + dy * s, z: nz + dz * s },
      { x: nx, y: ny, z: nz },
      1600,
    );
  }, [focusNode, nodeById, display.focusZoom]);

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
    controls.dampingFactor = 0.03;
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
    linkMaterial.linewidth = display.linkThickness * 2;
    return () => {
      controls.removeEventListener("start", stopRotate);
      controls.removeEventListener("end", armRotate);
      clearTimeout(timer);
    };
  }, []);

  // keep the line material's resolution matched to the canvas so screen-space
  // linewidth stays correct across resizes (panel open/close, window resize)
  useEffect(() => {
    linkMaterial.resolution.set(width, height);
    liteLinkMaterial.resolution.set(width, height);
  }, [width, height, linkMaterial, liteLinkMaterial]);

  // preview open ⇒ stop now and stay stopped; close ⇒ normal idle re-arm
  useEffect(() => {
    if (rotationPaused) rotationCtl.current?.stop();
    else rotationCtl.current?.arm();
  }, [rotationPaused]);

  // highlights always win, then group color, then domain palette; heat
  // brightens whichever won rather than replacing it
  const displayColor = useCallback(
    (node: NodeObj): string => {
      const id = String(node.id);
      const hk = hlKey(node as { id: string | number; file?: string });
      const t = heatOf(stateRef.current, hk);
      // modified recolors the sphere; a read gets a ring sprite (Task 3)
      if (nodeDisplay(stateRef.current, hk) === "modified")
        return brighten(COLORS.modified, t);
      return brighten(
        baseNodeColor(
          { id, type: node.type, domain: node.domain },
          domains,
          groups,
        ),
        t,
      );
    },
    [stateRef, domains, groups],
  );

  const updateNodeAdornment = useCallback(
    (node: NodeObj, item: NodeAdornment, now: number) => {
      const id = String(node.id);
      const hk = hlKey(node as { id: string | number; file?: string });
      const r = displayRadius(
        node.r ?? 4,
        display.nodeSize,
        heatOf(stateRef.current, hk),
      );
      const sphereR = sphereRadius(r);
      item.glow.scale.setScalar(sphereR * 4);
      item.glow.material = materials.glow(displayColor(node));
      item.readRing.scale.setScalar(sphereR * 3);
      item.readRing.visible = nodeDisplay(stateRef.current, hk) === "ring";
      item.matchRing.scale.setScalar(sphereR * 3.3);
      item.matchRing.visible =
        matchProgress(stateRef.current, now) !== null &&
        stateRef.current.matched.has(hk);
      item.focusRing.scale.setScalar(sphereR * 3.6);
      item.focusRing.visible = id === focusNode;
      item.label.position.set(0, -(r + 4), 0);
    },
    [display.nodeSize, materials, displayColor, stateRef, focusNode],
  );

  const updateAllNodeAdornments = useCallback(() => {
    const now = performance.now();
    for (const n of data.nodes as NodeObj[]) {
      const item = nodeAdornments.current.get(String(n.id));
      if (item) updateNodeAdornment(n, item, now);
    }
  }, [data, updateNodeAdornment]);

  useEffect(() => {
    updateAllNodeAdornments();
  }, [updateAllNodeAdornments]);

  // ponytail: rings/colors are baked into node objects, so poll the store's
  // rev counter and re-run accessors once per change (covers add AND reset).
  // Trail arrows rebuild every tick (cheap — dozens at most) to track drift.
  const lastRev = useRef(-1);
  useEffect(() => {
    if (lite) return; // static fleet: rev never changes, trail always empty
    const id = setInterval(() => {
      const s = stateRef.current;
      expireMatches(s, performance.now());
      if (s.rev !== lastRev.current) {
        lastRev.current = s.rev;
        updateAllNodeAdornments();
      }
      const g = trailGroup.current;
      if (!g) return;
      clearTrail(g);
      // ponytail: trail entries are file-path ids; in symbol mode no symbol node
      // carries that id, so trail arrows simply don't resolve here. Structure-first.
      for (let i = 0; i < s.trail.length - 1; i++) {
        const a = nodeById.get(s.trail[i]);
        const b = nodeById.get(s.trail[i + 1]);
        if (!a || !b || a.x === undefined || b.x === undefined) continue;
        const from = new Vector3(a.x ?? 0, a.y ?? 0, a.z ?? 0);
        const dir = new Vector3(b.x ?? 0, b.y ?? 0, b.z ?? 0).sub(from);
        const len = dir.length();
        // stop at the sphere surfaces
        const ra = sphereRadius(displayRadius(a.r ?? 4, display.nodeSize, 0));
        const rb = sphereRadius(displayRadius(b.r ?? 4, display.nodeSize, 0));
        if (len < ra + rb + 2) continue; // spheres touching — no room
        dir.normalize();
        const arrow = new ArrowHelper(
          dir,
          from.addScaledVector(dir, ra + 1),
          len - ra - rb - 2,
          COLORS.trail,
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
  }, [stateRef, nodeById, display.nodeSize, lite, updateAllNodeAdornments]);

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
    liteLinkMaterial.linewidth = display.linkThickness * 2;
    liteLinkMaterial.opacity = display.linkOpacity;
    materials.setGlowOpacity(display.nodeOpacity);
    writeMergedPositions(); // re-seat link ends on the resized spheres (lite no-ops if idle)
    fgRef.current?.refresh();
  }, [display, groups, linkMaterial, liteLinkMaterial]);

  const nodeThreeObject = useCallback(
    (node: NodeObj) => {
      const id = String(node.id);
      let item = nodeAdornments.current.get(id);
      if (!item) {
        const group = new Group();
        const glow = new Sprite(materials.glow(displayColor(node)));
        const readRing = new Sprite(materials.ring(COLORS.ring));
        const matchRing = new Sprite(materials.ring(COLORS.match));
        const focusRing = new Sprite(materials.ring(COLORS.hover));
        const label = new SpriteText(nodeLabelText(id, node.type));
        label.color = COLORS.label;
        label.textHeight = 4;
        label.visible = sprites.current.get(id)?.visible ?? true;
        group.add(glow);
        group.add(readRing);
        group.add(matchRing);
        group.add(focusRing);
        group.add(label as unknown as Sprite);
        item = { group, glow, readRing, matchRing, focusRing, label };
        nodeAdornments.current.set(id, item);
        sprites.current.set(id, label);
      }
      updateNodeAdornment(node, item, performance.now());
      return item.group;
    },
    [materials, displayColor, updateNodeAdornment],
  );

  return (
    <ForceGraph3D
      ref={fgRef}
      graphData={data}
      width={width}
      height={height}
      backgroundColor={COLORS.bg}
      controlType="orbit"
      nodeResolution={lite ? 10 : 16}
      cooldownTicks={300} // settle in ~1-2s instead of the default 15s so the fit fires promptly
      onEngineStop={() => {
        if (lite) writeMergedPositions(); // final coords, even on a 0-tick settle
        if (didFit.current) return;
        didFit.current = true;
        fgRef.current?.zoomToFit(300, -400);
      }}
      nodeLabel="id"
      nodeVal={(node: NodeObj) =>
        displayRadius(
          node.r ?? 4,
          display.nodeSize,
          heatOf(
            stateRef.current,
            hlKey(node as { id: string | number; file?: string }),
          ),
        ) ** 2
      }
      nodeThreeObjectExtend={true}
      nodeThreeObject={nodeThreeObject}
      nodeColor={displayColor}
      // lite: links are drawn by the single merged LineSegments2 above, so the
      // library renders none of its own; onEngineTick keeps them following nodes
      linkVisibility={!lite}
      onEngineTick={lite ? writeMergedPositions : undefined}
      linkThreeObject={lite ? undefined : linkThreeObject}
      linkPositionUpdate={
        lite
          ? undefined
          : (obj: Line2, ends: { start: Coords; end: Coords }) => {
              obj.geometry.setPositions([
                ends.start.x,
                ends.start.y,
                ends.start.z,
                ends.end.x,
                ends.end.y,
                ends.end.z,
              ]);
              return true; // we own positioning — skip the default handler
            }
      }
      onNodeClick={(node: NodeObj) => {
        if (node.type === "note") onNodeClick(String(node.id));
      }}
    />
  );
}
