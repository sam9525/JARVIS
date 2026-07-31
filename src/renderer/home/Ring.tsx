import React, { useEffect, useMemo, useRef, useState } from "react";
import type {
  GraphGroup,
  StatusKind,
  VaultGraph,
  ViewSettings,
  Workspace,
  WorkspaceStatus,
} from "../../shared/types";
import { SOURCE_LABELS } from "../../shared/types";
import { emptyState, type HighlightState } from "../session/highlight-store";
import Graph3D from "../graph/Graph3D";
import EmptyGraph, { canIndex, type IndexState } from "../graph/EmptyGraph";
import { domainsOf } from "../graph/domain-colors";
import { ringLayout, rotationTo, snapRotation } from "../graph/ring-layout";
import { DOT } from "./MissionControl";
import { useHandControl } from "../hands/use-hand-control";

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
// ring degrees per normalized unit of pinch travel — a hand crossing most of
// the camera frame turns most of the ring. Starting value, tune on camera.
const HAND_DEG_PER_UNIT = 300;

type RingProps = {
  workspaces: Workspace[];
  statuses: WorkspaceStatus[];
  graphs: Map<string, VaultGraph>; // the cardGraphs cache; absent = loading
  getStore: (workspaceId: string) => HighlightState;
  groups: Record<string, GraphGroup[]>; // per workspace id
  view: ViewSettings; // the 3d view — the centre graph renders with it
  width: number;
  height: number;
  indexing: Record<string, { state: IndexState; error?: string }>;
  layoutEpoch: number; // ↻ bumps this — reset rotation, re-arm the centre fit
  onIndex: (workspaceId: string) => void;
  onOpen: (ws: Workspace) => void;
};

// Every workspace on one rotating ring, the centred one's graph in the hollow
// middle. Tiles are DOM, deliberately without mini-graphs — N live force
// simulations is precisely what makes the card grid expensive.
export default function Ring({
  workspaces,
  statuses,
  graphs,
  getStore,
  groups,
  view,
  width,
  height,
  indexing,
  layoutEpoch,
  onIndex,
  onOpen,
}: RingProps) {
  const count = workspaces.length;
  const [rotation, setRotation] = useState(0);
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
  const wheelSnap = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );

  const byId = useMemo(
    () => new Map(statuses.map((s) => [s.workspaceId, s])),
    [statuses],
  );
  const { tiles, centeredIndex } = ringLayout(count, rotation);

  // debounce the centred workspace into settledId; every rotation change
  // resets the timer, so only a stop loads a graph
  useEffect(() => {
    const id = workspaces[centeredIndex]?.id ?? null;
    const t = setTimeout(() => setSettledId(id), SETTLE_MS);
    return () => clearTimeout(t);
  }, [rotation, centeredIndex, workspaces]);

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

  const hands = useHandControl({
    rotate: (dx) => {
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
  });

  const g = settledWs ? graphs.get(settledWs.id) : undefined;
  // same rule as the cards: absent from the map = still loading; empty on a
  // code workspace = never analyzed, which earns the index button
  const needsIndex =
    !!settledWs && canIndex(settledWs) && !!g && !g.nodes.length;
  const domains = useMemo(() => (g ? domainsOf(g) : []), [g]);
  const idx = settledWs ? indexing[settledWs.id] : undefined;

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
            <Graph3D
              // remount per workspace: a fresh mount re-fits the camera and
              // starts a clean simulation — exactly the one settle we pay for
              key={settledWs.id}
              graph={g}
              domains={domains}
              groups={groups[settledWs.id] ?? []}
              display={view.display}
              forces={view.forces}
              stateRef={stateRef}
              onNodeClick={() => undefined}
              focusNode={null}
              layoutEpoch={layoutEpoch}
              rotationPaused={false}
              width={width}
              height={height}
            />
          ))}
      </div>

      <div className="absolute bottom-3 left-3 z-20 flex items-center gap-2">
        <button
          data-testid="hand-toggle"
          onClick={(e) => {
            e.stopPropagation();
            hands.toggle();
          }}
          onPointerDown={(e) => e.stopPropagation()}
          className={
            "flex items-center gap-1.5 rounded border bg-panel px-2 py-1 font-mono text-[10px] uppercase tracking-widest " +
            (hands.enabled
              ? "border-accent text-ink"
              : "border-edge text-ink-dim hover:text-ink")
          }
        >
          {hands.enabled && (
            <span
              data-testid="hand-live"
              className="h-1.5 w-1.5 animate-pulse rounded-full bg-warm"
            />
          )}
          hands
        </button>
        {hands.error && (
          <span data-testid="hand-error" className="text-[10px] text-warm">
            {hands.error}
          </span>
        )}
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
                left: "calc(50% + var(--ring-dx))",
                top: "calc(50% + var(--ring-dy))",
                transform: "translate3d(-50%, -50%, 0) scale(var(--ring-s))",
                opacity: 0.35 + 0.65 * t.depth,
                zIndex: 10 + Math.round(t.depth * 100),
              } as React.CSSProperties
            }
            className={
              "ring-tile-in absolute flex cursor-pointer select-none flex-col gap-1.5 rounded-lg border bg-panel p-2.5 " +
              (dragging
                ? "transition-opacity "
                : "transition-[left,top,transform,opacity] duration-300 ease-out ") +
              (kind === "waiting"
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
