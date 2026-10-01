import React, { useEffect, useMemo, useRef, useState } from "react";
import type {
  GraphGroup,
  StatusKind,
  VaultGraph,
  ViewSettings,
  Workspace,
  WorkspaceStatus,
} from "../../shared/types";
import { NO_GROUPS, SOURCE_LABELS } from "../../shared/types";
import { emptyState, type HighlightState } from "../session/highlight-store";
import Graph3D, { type Graph3DHandle } from "../graph/Graph3D";
import EmptyGraph, { canIndex, type IndexState } from "../graph/EmptyGraph";
import { domainsOf } from "../graph/domain-colors";
import { hueOfWorkspace } from "../graph/workspace-color";
import { filterGraph, type GraphFilters } from "../graph/graph-filter";
import { ringLayout, rotationTo, snapRotation } from "../graph/ring-layout";
import { DOT } from "./MissionControl";
import { useHandActions, type HandActions } from "../hands/use-hand-actions";

const TILE_W = 176;
// the release's one performance rule: the centre graph loads only after
// rotation rests this long — spinning past eight tiles starts one force
// simulation, not eight
const SETTLE_MS = 300;
const WHEEL_DEG = 0.2; // ring degrees per wheel deltaY unit
const DRAG_DEG_PER_PX = 0.35;
const WHEEL_SNAP_MS = 200; // a wheel has no "release" — snap after this idle
const DRAG_SUPPRESS_PX = 5; // past this travel a pointer-up is a drag, not a click
const ENTER_STAGGER_MS = 70; // tiles fly out of the hub one after another on open
const ENTER_MS = 500; // one tile's fly-out — must match .ring-tile-in in index.css
// ring degrees per normalized unit of pinch travel — a hand crossing most of
// the camera frame turns most of the ring. Starting value, tune on camera.
const HAND_DEG_PER_UNIT = 300;

type RingProps = {
  workspaces: Workspace[];
  mainColors?: Record<string, string>; // workspace id → its main colour
  statuses: WorkspaceStatus[];
  graphs: Map<string, VaultGraph>; // the cardGraphs cache; absent = loading
  getStore: (workspaceId: string) => HighlightState;
  groups: Record<string, GraphGroup[]>; // per workspace id
  view: ViewSettings; // the 3d view — the centre graph renders with it
  // the section/tag/orphan filters the workspace view uses, so the centre graph
  // is the same graph opening the workspace gives you; search is left out on
  // purpose — it belongs to the workspace you have open, not to every tile
  filters: Omit<GraphFilters, "search">;
  width: number;
  height: number;
  indexing: Record<string, { state: IndexState; error?: string }>;
  layoutEpoch: number; // ↻ bumps this — reset rotation, re-arm the centre fit
  actionsRef: React.MutableRefObject<HandActions>; // hand gestures land here
  onIndex: (workspaceId: string) => void;
  onOpen: (ws: Workspace) => void;
  // the ring unmounts whenever you leave it, so the owner keeps which
  // workspace was centred and the ring opens back onto it
  centreId: string | null;
  onCentre: (workspaceId: string) => void;
};

// Every workspace on one rotating ring, the centred one's graph in the hollow
// middle. Tiles are DOM, deliberately without mini-graphs — N live force
// simulations is precisely what makes the card grid expensive.
export default function Ring({
  workspaces,
  mainColors,
  statuses,
  graphs,
  getStore,
  groups,
  view,
  filters,
  width,
  height,
  indexing,
  layoutEpoch,
  actionsRef,
  onIndex,
  onOpen,
  centreId,
  onCentre,
}: RingProps) {
  const count = workspaces.length;
  const [rotation, setRotation] = useState(() => {
    const i = workspaces.findIndex((w) => w.id === centreId);
    return i > 0 ? rotationTo(i, 0, count) : 0;
  });
  const [settledId, setSettledId] = useState<string | null>(null);
  // tiles animate to their new positions, except while a drag/wheel is driving
  // them — a transition mid-drag just lags behind the pointer
  const [dragging, setDragging] = useState(false);
  const stateRef = useRef<HighlightState>(emptyState());
  const drag = useRef<{
    lastX: number;
    travel: number;
    captured: boolean;
  } | null>(null);
  const suppressClick = useRef(false);
  const centreHandle = useRef<Graph3DHandle | null>(null);
  const wheelSnap = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );

  const byId = useMemo(
    () => new Map(statuses.map((s) => [s.workspaceId, s])),
    [statuses],
  );
  const { tiles, centeredIndex } = ringLayout(count, rotation);

  // the settle cannot fire until the last tile has landed, so the centre
  // graph's fade-in follows the ring's entrance instead of racing it. A
  // deadline, not a delay — a wheel mid-entrance must not push it further out.
  const enterDone = useRef(
    Date.now() + ENTER_MS + Math.max(0, count - 1) * ENTER_STAGGER_MS,
  );

  // debounce the centred workspace into settledId; every rotation change
  // resets the timer, so only a stop loads a graph
  useEffect(() => {
    const id = workspaces[centeredIndex]?.id ?? null;
    const t = setTimeout(
      () => setSettledId(id),
      Math.max(SETTLE_MS, enterDone.current - Date.now()),
    );
    return () => clearTimeout(t);
  }, [rotation, centeredIndex, workspaces]);

  useEffect(() => {
    const id = workspaces[centeredIndex]?.id;
    if (id) onCentre(id);
  }, [centeredIndex, workspaces, onCentre]);

  useEffect(() => () => clearTimeout(wheelSnap.current), []);

  // ↻ resets the whole view: Graph3D re-arms its one-time fit off the epoch,
  // returning the ring to the front is ours. Epoch 0 is the initial value, not
  // a refresh — don't fight a fresh mount's state (design §2.1).
  useEffect(() => {
    if (layoutEpoch === 0) return;
    setRotation(0);
  }, [layoutEpoch]);

  const settledWs = workspaces.find((w) => w.id === settledId) ?? null;

  // the centre graph polls stateRef per frame, same as the main view — point
  // it at the settled workspace's own store so live highlights keep working
  useEffect(() => {
    if (settledWs) stateRef.current = getStore(settledWs.id);
  }, [settledWs, getStore]);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    suppressClick.current = false;
    drag.current = { lastX: e.clientX, travel: 0, captured: false };
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.lastX;
    if (dx === 0) return;
    d.lastX = e.clientX;
    d.travel += Math.abs(dx);
    // capture only once this is a real drag: while a pointer is captured the
    // browser retargets the click to the capturing element, so capturing on
    // pointerdown means a tap on a tile never reaches the tile's onClick
    if (!d.captured && d.travel > DRAG_SUPPRESS_PX) {
      d.captured = true;
      setDragging(true);
      e.currentTarget.setPointerCapture?.(e.pointerId);
    }
    // dragging right pulls the front of the ring right
    setRotation((r) => r - dx * DRAG_DEG_PER_PX);
  };

  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    setDragging(false);
    if (!d) return;
    if (d.travel > DRAG_SUPPRESS_PX) suppressClick.current = true;
    setRotation((r) => snapRotation(r, count));
  };

  const onWheel = (e: React.WheelEvent) => {
    setRotation((r) => r + e.deltaY * WHEEL_DEG);
    setDragging(true);
    clearTimeout(wheelSnap.current);
    wheelSnap.current = setTimeout(() => {
      setDragging(false);
      setRotation((r) => snapRotation(r, count));
    }, WHEEL_SNAP_MS);
  };

  // a click never both moves and commits: centred opens, anything else only
  // rotates to centre
  const onTileClick = (i: number) => {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    if (i === centeredIndex) onOpen(workspaces[i]);
    else setRotation((r) => rotationTo(i, r, count));
  };

  // pinch is the content hand (the ring), palm is the camera hand (the
  // centre graph — orbit and zoom, but not drag: it is still not a pointer
  // control surface). Registered during render so `open` reads the live
  // centeredIndex (design §4, §6).
  useHandActions(actionsRef, {
    drag: (dx) => {
      setDragging(true);
      setRotation((r) => r - dx * HAND_DEG_PER_UNIT);
    },
    snap: () => {
      setDragging(false);
      setRotation((r) => snapRotation(r, count));
    },
    step: (dir) => {
      if (count)
        setRotation((r) => snapRotation(r, count) - dir * (360 / count));
    },
    open: () => {
      const w = workspaces[centeredIndex];
      if (w) onOpen(w);
    },
    orbit: (v) => centreHandle.current?.spin(v),
    zoom: (f) => centreHandle.current?.zoom(f),
  });

  const raw = settledWs ? graphs.get(settledWs.id) : undefined;
  // same rule as the cards: absent from the map = still loading; empty on a
  // code workspace = never analyzed, which earns the index button. Judged on
  // the unfiltered graph, since a filter hiding everything is not "never
  // analyzed".
  const needsIndex =
    !!settledWs && canIndex(settledWs) && !!raw && !raw.nodes.length;
  // depends on the filter FIELDS, not the object: a fresh-but-equal filters
  // object each render would hand force-graph new data and restart the settle
  const g = useMemo(
    () =>
      raw
        ? filterGraph(raw, {
            // code workspaces have no sections; force "both" so nothing
            // vanishes, exactly as App does for the open workspace
            sectionFilter:
              settledWs?.kind === "code" ? "both" : filters.sectionFilter,
            search: "",
            showTags: filters.showTags,
            showOrphans: filters.showOrphans,
          })
        : undefined,
    [
      raw,
      settledWs,
      filters.sectionFilter,
      filters.showTags,
      filters.showOrphans,
    ],
  );
  // palette indices come off the FULL graph, same as the workspace view — a
  // filter must not recolour the nodes it leaves behind
  const domains = useMemo(() => (raw ? domainsOf(raw) : []), [raw]);
  const idx = settledWs ? indexing[settledWs.id] : undefined;

  // rotation is component state, so every pointermove/wheel tick re-renders
  // the ring; memoizing the centre element keeps those renders from
  // reconciling the graph at all, and stabilizes the onNodeClick literal
  // (v0.3.5 §5.3). deps are what the element actually reads — refs
  // (stateRef, centreHandle) are stable by construction.
  const centreGraph = useMemo(() => {
    if (!settledWs || !g) return null;
    return (
      <Graph3D
        // remount per workspace: a fresh mount re-fits the camera and
        // starts a clean simulation — exactly the one settle we pay for
        key={settledWs.id}
        graph={g}
        domains={domains}
        baseHue={hueOfWorkspace(settledWs, workspaces, mainColors)}
        groups={groups[settledWs.id] ?? NO_GROUPS}
        display={view.display}
        forces={view.forces}
        stateRef={stateRef}
        handleRef={centreHandle}
        onNodeClick={() => undefined}
        focusNode={null}
        layoutEpoch={layoutEpoch}
        rotationPaused={false}
        width={width}
        height={height}
      />
    );
  }, [
    settledWs,
    workspaces,
    g,
    domains,
    groups,
    view,
    layoutEpoch,
    width,
    height,
  ]);

  return (
    <div
      data-testid="ring"
      className="relative isolate h-full w-full touch-none overflow-hidden"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onWheel={onWheel}
    >
      {/* the centre graph is a display, not a control: without this a wheel or
          drag hits the 3D camera and the ring rotation at the same time */}
      <div
        data-testid="ring-centre"
        className="pointer-events-none absolute inset-0"
      >
        {settledWs &&
          g &&
          (needsIndex ? (
            <div className="pointer-events-auto absolute inset-0 flex items-center justify-center">
              <EmptyGraph
                state={idx?.state ?? "idle"}
                error={idx?.error}
                onIndex={() => onIndex(settledWs.id)}
              />
            </div>
          ) : (
            centreGraph
          ))}
      </div>

      {tiles.map((t, i) => {
        const w = workspaces[i];
        const st = byId.get(w.id);
        const kind: StatusKind = st?.kind ?? "none";
        return (
          <div
            key={w.id}
            data-testid={`tile-${w.id}`}
            data-centered={t.centered || undefined}
            role="button"
            tabIndex={0}
            onClick={() => onTileClick(i)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onTileClick(i);
              }
            }}
            style={
              {
                width: TILE_W,
                // the depth^6 term is the "you're looking at this one" bump: it
                // only pays out in the last few degrees, so the tile grows into
                // centre instead of popping when `centered` flips
                "--ring-s": `${0.5 + 0.4 * t.depth + 0.35 * t.depth ** 6}`,
                "--ring-dx": `${t.x * (width * 0.4)}px`,
                "--ring-dy": `${t.y * (height * 0.36)}px`,
                animationDelay: `${i * ENTER_STAGGER_MS}ms`,
                // ring offsets live in the transform, not left/top: moving a
                // tile is then composite-only instead of layout+paint per
                // frame for every tile (v0.3.5 §5.2)
                left: "50%",
                top: "50%",
                transform:
                  "translate3d(calc(-50% + var(--ring-dx)), calc(-50% + var(--ring-dy)), 0) scale(var(--ring-s))",
                opacity: 0.35 + 0.65 * t.depth,
                zIndex: 10 + Math.round(t.depth * 100),
              } as React.CSSProperties
            }
            className={
              "ring-tile-in absolute flex cursor-pointer select-none flex-col gap-1.5 rounded-lg border bg-panel p-2.5 " +
              (dragging
                ? "transition-opacity "
                : "transition-[transform,opacity] duration-300 ease-out ") +
              (kind === "asking" || kind === "blocked"
                ? "border-warm"
                : t.centered
                  ? "border-accent"
                  : "border-edge")
            }
          >
            <div className="flex items-center justify-between gap-2">
              <span className="overflow-hidden text-ellipsis whitespace-nowrap text-[12.5px] font-semibold text-ink">
                {w.name}
              </span>
              <span
                className={`h-1.5 w-1.5 shrink-0 rounded-full ${DOT[kind]}`}
              />
            </div>
            <span
              data-testid={`tile-source-${w.id}`}
              className="font-mono text-[9px] uppercase tracking-widest text-ink-dim"
            >
              {SOURCE_LABELS[w.sourceId] ?? w.sourceId}
            </span>
            <div
              data-testid={`tile-call-${w.id}`}
              title={st?.call || undefined}
              className="overflow-hidden text-ellipsis whitespace-nowrap font-mono text-[10.5px] text-accent-soft"
            >
              {st?.call || " "}
            </div>
            <div
              data-testid={`tile-counts-${w.id}`}
              className="flex gap-2.5 font-mono text-[10px] tabular-nums text-ink-dim"
            >
              <span>{st?.reads ?? 0} read</span>
              <span>{st?.edits ?? 0} edited</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
