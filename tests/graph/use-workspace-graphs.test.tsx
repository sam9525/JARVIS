// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/no-explicit-any */
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { useWorkspaceGraphs } from "../../src/renderer/graph/use-workspace-graphs";
import { snapshots } from "../../src/renderer/graph/card-snapshot";
import type {
  CardLayout,
  StoredSnapshot,
  VaultGraph,
  Workspace,
} from "../../src/shared/types";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const ws = (id: string, kind: Workspace["kind"]): Workspace => ({
  id,
  name: id,
  rootPath: `/tmp/${id}`,
  kind,
  sourceId: kind === "vault" ? "vault" : "gitnexus",
});

const graphOf = (...ids: string[]): VaultGraph => ({
  nodes: ids.map((id) => ({ id, type: "note" as const })),
  edges: [],
});

/**
 * Render a hook with the real React runtime — the caching this covers lives in
 * useRef across renders, which the fake-React mocking used elsewhere in this
 * suite cannot reproduce (it hands out a new ref per call).
 */
function renderHook<P, R>(hook: (props: P) => R, initial: P) {
  const box = { current: undefined as unknown as R };
  let root: Root;
  const container = document.createElement("div");
  function Probe({ props }: { props: P }) {
    box.current = hook(props);
    return null;
  }
  act(() => {
    root = createRoot(container);
    root.render(<Probe props={initial} />);
  });
  return {
    get result() {
      return box.current;
    },
    rerender: (props: P) =>
      act(() => {
        root.render(<Probe props={props} />);
      }),
    unmount: () => act(() => root.unmount()),
  };
}

// flush a resolved promise chain inside act, so state set from a .then lands
const settle = () => act(async () => await Promise.resolve());

const jarvis = {
  getGraph: vi.fn(),
  getSymbolGraph: vi.fn(),
  rescan: vi.fn(),
  getWorkspaces: vi.fn(),
  indexProject: vi.fn(),
  getCardSnapshots: vi.fn(),
};

const layout: CardLayout = {
  width: 100,
  height: 100,
  transform: { k: 1, x: 0, y: 0 },
  nodes: [{ id: "n", hk: "n", x: 0, y: 0, r: 2, fill: "#ffffff" }],
  links: [],
};

const stored = (id: string): StoredSnapshot => ({
  format: 1,
  id,
  fingerprint: "vault:x",
  look: "look",
  layout,
});

type Params = Parameters<typeof useWorkspaceGraphs>[0];

const params = (over: Partial<Params> = {}): Params => ({
  active: null,
  activeIdRef: { current: null },
  codeGraphLevel: "file",
  workspaces: [],
  showHome: false,
  homeView: "cards",
  onWorkspacesChanged: () => undefined,
  ...over,
});

beforeEach(() => {
  for (const fn of Object.values(jarvis)) fn.mockReset();
  jarvis.getGraph.mockResolvedValue(graphOf("a"));
  jarvis.getSymbolGraph.mockResolvedValue(graphOf("sym"));
  jarvis.rescan.mockResolvedValue(graphOf("rescanned"));
  jarvis.getWorkspaces.mockResolvedValue([]);
  jarvis.indexProject.mockResolvedValue({ ok: true });
  jarvis.getCardSnapshots.mockResolvedValue([]);
  snapshots.clear();
  (globalThis as any).window.jarvis = jarvis;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useWorkspaceGraphs", () => {
  it("fetches each workspace's graph once — a switch back is served from cache", async () => {
    const vault = ws("v", "vault");
    const other = ws("o", "vault");
    const activeIdRef = { current: "v" as string | null };
    const base = params({ activeIdRef, active: vault });
    const h = renderHook(useWorkspaceGraphs, base);
    await settle();
    expect(h.result.graph.nodes.map((n) => n.id)).toEqual(["a"]);
    expect(jarvis.getGraph).toHaveBeenCalledTimes(1);

    activeIdRef.current = "o";
    h.rerender({ ...base, active: other });
    await settle();
    activeIdRef.current = "v";
    h.rerender({ ...base, active: vault });
    await settle();
    expect(jarvis.getGraph).toHaveBeenCalledTimes(2);
    expect(h.result.graph.nodes.map((n) => n.id)).toEqual(["a"]);
  });

  it("drops a graph that resolves after you already switched away", async () => {
    const activeIdRef = { current: "slow" as string | null };
    let release!: (g: VaultGraph) => void;
    jarvis.getGraph.mockReturnValueOnce(
      new Promise<VaultGraph>((res) => {
        release = res;
      }),
    );
    const base = params({ activeIdRef, active: ws("slow", "vault") });
    const h = renderHook(useWorkspaceGraphs, base);

    activeIdRef.current = "other";
    h.rerender({ ...base, active: null });
    await act(async () => {
      release(graphOf("stale"));
    });
    await settle();

    expect(h.result.graph.nodes).toEqual([]);
  });

  it("keeps file and symbol graphs in separate caches", async () => {
    const code = ws("c", "code");
    const activeIdRef = { current: "c" as string | null };
    const base = params({ activeIdRef, active: code, codeGraphLevel: "file" });
    const h = renderHook(useWorkspaceGraphs, base);
    await settle();
    expect(h.result.graph.nodes.map((n) => n.id)).toEqual(["a"]);

    h.rerender({ ...base, codeGraphLevel: "symbol" });
    await settle();
    expect(h.result.graph.nodes.map((n) => n.id)).toEqual(["sym"]);

    // back to files: served from the file cache, which the symbol view
    // must not have evicted
    h.rerender({ ...base, codeGraphLevel: "file" });
    await settle();
    expect(h.result.graph.nodes.map((n) => n.id)).toEqual(["a"]);
    expect(jarvis.getGraph).toHaveBeenCalledTimes(1);
    expect(jarvis.getSymbolGraph).toHaveBeenCalledTimes(1);
  });

  it("caps an oversized symbol graph", async () => {
    const big = {
      nodes: Array.from({ length: 700 }, (_, i) => ({
        id: `s${i}`,
        type: "note" as const,
      })),
      edges: [],
    };
    jarvis.getSymbolGraph.mockResolvedValue(big);
    const code = ws("c", "code");
    const h = renderHook(
      useWorkspaceGraphs,
      params({
        activeIdRef: { current: "c" },
        active: code,
        codeGraphLevel: "symbol",
      }),
    );
    await settle();
    expect(h.result.graph.nodes.length).toBe(600);
  });

  it("clears graphLoading when a code graph fails to load", async () => {
    jarvis.getGraph.mockRejectedValue(new Error("no index"));
    const code = ws("c", "code");
    const h = renderHook(
      useWorkspaceGraphs,
      params({ activeIdRef: { current: "c" }, active: code }),
    );
    await settle();
    // otherwise the "index this project" panel never appears
    expect(h.result.graphLoading).toBe(false);
    expect(h.result.graph.nodes).toEqual([]);
  });

  it("shows a failed graph but fetches it again on the next visit", async () => {
    const failed: VaultGraph = { nodes: [], edges: [], failed: "busy" };
    jarvis.getGraph.mockResolvedValueOnce(failed);
    const code = ws("c", "code");
    const other = ws("o", "vault");
    const activeIdRef = { current: "c" as string | null };
    const base = params({ activeIdRef, active: code });
    const h = renderHook(useWorkspaceGraphs, base);
    await settle();
    expect(h.result.graph.failed).toBe("busy");

    activeIdRef.current = "o";
    h.rerender({ ...base, active: other });
    await settle();
    activeIdRef.current = "c";
    h.rerender({ ...base, active: code });
    await settle();
    // c twice (failed, then ok) + o once
    expect(jarvis.getGraph).toHaveBeenCalledTimes(3);
    expect(h.result.graph.nodes.map((n) => n.id)).toEqual(["a"]);
  });

  it("puts a failed card graph on the card without caching it", async () => {
    const failed: VaultGraph = { nodes: [], edges: [], failed: "busy" };
    jarvis.getGraph.mockResolvedValueOnce(failed);
    const list = [ws("c", "code")];
    const base = params({ showHome: true, workspaces: list });
    const h = renderHook(useWorkspaceGraphs, base);
    await settle();
    await settle();
    expect(h.result.cardGraphs.get("c")?.failed).toBe("busy");

    h.rerender({ ...base, showHome: false });
    h.rerender(base);
    await settle();
    await settle();
    expect(jarvis.getGraph).toHaveBeenCalledTimes(2);
    expect(h.result.cardGraphs.get("c")?.failed).toBeUndefined();
  });

  it("shows a watched graph only while its workspace is open", async () => {
    const activeIdRef = { current: "v" as string | null };
    const h = renderHook(useWorkspaceGraphs, params({ activeIdRef }));

    await act(async () => h.result.applyWatchedGraph("v", graphOf("watched")));
    expect(h.result.graph.nodes.map((n) => n.id)).toEqual(["watched"]);

    // a push for a background workspace is cached, not displayed
    await act(async () =>
      h.result.applyWatchedGraph("other", graphOf("background")),
    );
    expect(h.result.graph.nodes.map((n) => n.id)).toEqual(["watched"]);
  });

  it("caches a watched graph so opening that workspace needs no fetch", async () => {
    const activeIdRef = { current: null as string | null };
    const base = params({ activeIdRef });
    const h = renderHook(useWorkspaceGraphs, base);
    await act(async () => h.result.applyWatchedGraph("v", graphOf("watched")));

    activeIdRef.current = "v";
    h.rerender({ ...base, active: ws("v", "vault") });
    await settle();
    expect(jarvis.getGraph).not.toHaveBeenCalled();
    expect(h.result.graph.nodes.map((n) => n.id)).toEqual(["watched"]);
  });

  it("rescan replaces the cached graph rather than appending to it", async () => {
    const vault = ws("v", "vault");
    const activeIdRef = { current: "v" as string | null };
    const base = params({ activeIdRef, active: vault });
    const h = renderHook(useWorkspaceGraphs, base);
    await settle();
    await act(async () => h.result.refresh());
    await settle();
    expect(h.result.graph.nodes.map((n) => n.id)).toEqual(["rescanned"]);
  });

  it("reports an indexing failure against the project that failed", async () => {
    jarvis.indexProject.mockResolvedValue({ ok: false, error: "not a repo" });
    const h = renderHook(useWorkspaceGraphs, params());

    await act(async () => h.result.indexProject("c"));
    await settle();
    expect(h.result.indexing.c).toEqual({
      state: "error",
      error: "not a repo",
    });
    expect(jarvis.rescan).not.toHaveBeenCalled();
  });

  it("returns to idle after a successful index, having re-pulled the list", async () => {
    const onWorkspacesChanged = vi.fn();
    jarvis.getWorkspaces.mockResolvedValue([ws("c", "code")]);
    const h = renderHook(useWorkspaceGraphs, params({ onWorkspacesChanged }));

    await act(async () => h.result.indexProject("c"));
    await settle();
    expect(onWorkspacesChanged).toHaveBeenCalledWith([ws("c", "code")]);
    expect(h.result.indexing.c).toBeUndefined(); // idle, not stuck on "running"
    expect(h.result.cardGraphs.get("c")?.nodes.map((n) => n.id)).toEqual([
      "rescanned",
    ]);
  });

  it("loads a card graph per workspace on the command center", async () => {
    const list = [ws("v", "vault"), ws("c", "code")];
    const h = renderHook(
      useWorkspaceGraphs,
      params({ showHome: true, workspaces: list }),
    );
    await settle();
    await settle();
    expect([...h.result.cardGraphs.keys()].sort()).toEqual(["c", "v"]);
  });

  it("keeps loading cards after one workspace throws", async () => {
    jarvis.getGraph
      .mockRejectedValueOnce(new Error("bad index"))
      .mockResolvedValue(graphOf("ok"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const list = [ws("broken", "code"), ws("fine", "code")];
    const h = renderHook(
      useWorkspaceGraphs,
      params({ showHome: true, workspaces: list }),
    );
    await settle();
    await settle();
    expect(h.result.cardGraphs.has("broken")).toBe(false);
    expect(h.result.cardGraphs.get("fine")?.nodes.map((n) => n.id)).toEqual([
      "ok",
    ]);
  });

  it("starts every card fetch before any resolves", async () => {
    // never-resolving fetches: the sequential loop would be stuck on the
    // first await with the second workspace not yet requested
    jarvis.getGraph.mockImplementation(
      () => new Promise<VaultGraph>(() => undefined),
    );
    const list = [ws("v", "vault"), ws("c", "code")];
    renderHook(
      useWorkspaceGraphs,
      params({ showHome: true, workspaces: list }),
    );
    await settle();
    expect(jarvis.getGraph).toHaveBeenCalledTimes(2);
  });

  it("writes nothing into cardGraphs after leaving the command center mid-load", async () => {
    let release!: (g: VaultGraph) => void;
    jarvis.getGraph.mockReturnValue(
      new Promise<VaultGraph>((res) => {
        release = res;
      }),
    );
    const base = params({ showHome: true, workspaces: [ws("v", "vault")] });
    const h = renderHook(useWorkspaceGraphs, base);
    h.rerender({ ...base, showHome: false }); // cancels the load effect
    await act(async () => {
      release(graphOf("late"));
    });
    await settle();
    expect(h.result.cardGraphs.size).toBe(0);
  });

  // the boot entrance gates its graph stage on this, so "every scan failed"
  // has to settle the same as "every scan landed" — otherwise the slot waits
  // out the fallback and fades in over nothing
  it("reports the card pass settled once every workspace has landed", async () => {
    let release!: (g: VaultGraph) => void;
    jarvis.getGraph.mockReturnValue(
      new Promise<VaultGraph>((res) => {
        release = res;
      }),
    );
    const h = renderHook(
      useWorkspaceGraphs,
      params({ showHome: true, workspaces: [ws("v", "vault")] }),
    );
    await settle();
    expect(h.result.cardsLoaded).toBe(false);
    await act(async () => {
      release(graphOf("late"));
    });
    await settle();
    expect(h.result.cardsLoaded).toBe(true);
  });

  it("settles the card pass even when every scan fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    jarvis.getGraph.mockRejectedValue(new Error("no index"));
    const h = renderHook(
      useWorkspaceGraphs,
      params({ showHome: true, workspaces: [ws("v", "vault")] }),
    );
    await settle();
    expect(h.result.cardGraphs.size).toBe(0);
    expect(h.result.cardsLoaded).toBe(true);
  });

  describe("with stored card layouts", () => {
    const list = [ws("kept", "vault"), ws("bare", "code")];
    const fetched = () =>
      jarvis.getGraph.mock.calls.map((c) => c[0] as string).sort();

    it("loads only the cards with no stored layout on Cards", async () => {
      jarvis.getCardSnapshots.mockResolvedValue([stored("kept")]);
      renderHook(
        useWorkspaceGraphs,
        params({ showHome: true, workspaces: list }),
      );
      await settle();
      await settle();
      expect(snapshots.has("kept")).toBe(true);
      expect(fetched()).toEqual(["bare"]);
    });

    it("loads every remaining graph once Fleet opens", async () => {
      jarvis.getCardSnapshots.mockResolvedValue([stored("kept")]);
      const base = params({ showHome: true, workspaces: list });
      const h = renderHook(useWorkspaceGraphs, base);
      await settle();
      await settle();
      h.rerender({ ...base, homeView: "fleet" });
      await settle();
      await settle();
      expect(fetched()).toEqual(["bare", "kept"]);
      expect([...h.result.cardGraphs.keys()].sort()).toEqual(["bare", "kept"]);
    });

    it("fetches a requested graph once however often it is asked for", async () => {
      jarvis.getCardSnapshots.mockResolvedValue([stored("kept")]);
      const h = renderHook(
        useWorkspaceGraphs,
        params({ showHome: true, workspaces: [ws("kept", "vault")] }),
      );
      await settle();
      await settle();
      await act(async () => {
        h.result.requestGraph("kept");
        h.result.requestGraph("kept");
      });
      await settle();
      expect(fetched()).toEqual(["kept"]);
      expect(h.result.cardGraphs.has("kept")).toBe(true);
      await act(async () => h.result.requestGraph("kept"));
      expect(fetched()).toEqual(["kept"]);
    });

    it("drops the stored layout of a graph the watcher rebuilt", async () => {
      jarvis.getCardSnapshots.mockResolvedValue([stored("kept")]);
      const h = renderHook(
        useWorkspaceGraphs,
        params({ showHome: true, workspaces: [ws("kept", "vault")] }),
      );
      await settle();
      await settle();
      expect(snapshots.has("kept")).toBe(true);
      await act(async () =>
        h.result.applyWatchedGraph("kept", graphOf("rebuilt")),
      );
      expect(snapshots.has("kept")).toBe(false);
    });

    it("puts a watched graph on a card that already holds one", async () => {
      const h = renderHook(
        useWorkspaceGraphs,
        params({ showHome: true, workspaces: [ws("kept", "vault")] }),
      );
      await settle();
      await settle();
      expect(h.result.cardGraphs.get("kept")?.nodes[0].id).toBe("a");
      await act(async () =>
        h.result.applyWatchedGraph("kept", graphOf("rebuilt")),
      );
      expect(h.result.cardGraphs.get("kept")?.nodes[0].id).toBe("rebuilt");
    });

    it("a fleet refresh puts each rescanned graph on its card as it lands", async () => {
      let release!: (g: VaultGraph) => void;
      jarvis.rescan.mockImplementation((id: string) =>
        id === "slow"
          ? new Promise<VaultGraph>((res) => {
              release = res;
            })
          : Promise.resolve(graphOf("fresh")),
      );
      const h = renderHook(
        useWorkspaceGraphs,
        params({
          showHome: true,
          workspaces: [ws("fast", "vault"), ws("slow", "code")],
        }),
      );
      await settle();
      await settle();
      await act(async () => h.result.refresh());
      await settle();
      expect(h.result.cardGraphs.get("fast")?.nodes[0].id).toBe("fresh");
      expect(h.result.cardGraphs.get("slow")?.nodes[0].id).toBe("a");
      await act(async () => release(graphOf("late")));
      await settle();
      expect(h.result.cardGraphs.get("slow")?.nodes[0].id).toBe("late");
    });

    it("drops stored layouts on a rescan and on indexing", async () => {
      jarvis.getCardSnapshots.mockResolvedValue([
        stored("kept"),
        stored("bare"),
      ]);
      const base = params({ showHome: true, workspaces: list });
      const h = renderHook(useWorkspaceGraphs, base);
      await settle();
      await settle();
      await act(async () => h.result.refresh());
      await settle();
      expect(snapshots.size).toBe(0);

      const kept = ws("kept", "vault");
      snapshots.set("kept", { look: "look", layout });
      h.rerender({
        ...base,
        showHome: false,
        active: kept,
        activeIdRef: { current: "kept" },
      });
      await settle();
      await act(async () => h.result.refresh());
      await settle();
      expect(snapshots.has("kept")).toBe(false);

      snapshots.set("bare", { look: "look", layout });
      await act(async () => h.result.indexProject("bare"));
      await settle();
      expect(snapshots.has("bare")).toBe(false);
    });

    it("reports the cards ready only once the stored list has arrived", async () => {
      let release!: (list: StoredSnapshot[]) => void;
      jarvis.getCardSnapshots.mockReturnValue(
        new Promise<StoredSnapshot[]>((res) => {
          release = res;
        }),
      );
      const base = params({
        showHome: true,
        workspaces: [ws("kept", "vault")],
      });
      const h = renderHook(useWorkspaceGraphs, base);
      await settle();
      expect(h.result.snapshotsReady).toBe(false);
      expect(jarvis.getGraph).not.toHaveBeenCalled();

      await act(async () => release([stored("kept")]));
      await settle();
      expect(h.result.snapshotsReady).toBe(true);
      expect(jarvis.getGraph).not.toHaveBeenCalled();

      h.rerender({ ...base, showHome: false });
      expect(h.result.snapshotsReady).toBe(false);
    });

    it("settles a fully stored fleet with no graph load", async () => {
      jarvis.getCardSnapshots.mockResolvedValue([
        stored("kept"),
        stored("bare"),
      ]);
      const h = renderHook(
        useWorkspaceGraphs,
        params({ showHome: true, workspaces: list }),
      );
      await settle();
      await settle();
      expect(h.result.cardsLoaded).toBe(true);
      expect(jarvis.getGraph).not.toHaveBeenCalled();
    });

    it("treats an unreadable stored list as empty", async () => {
      jarvis.getCardSnapshots.mockRejectedValue(new Error("io"));
      const h = renderHook(
        useWorkspaceGraphs,
        params({ showHome: true, workspaces: list }),
      );
      await settle();
      await settle();
      expect(fetched()).toEqual(["bare", "kept"]);
      expect(h.result.cardsLoaded).toBe(true);
    });
  });
});
