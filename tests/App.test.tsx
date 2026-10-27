/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-empty-function */
import { vi, describe, it, expect, beforeAll, beforeEach } from "vitest";

// Mock React hooks so the App function component can be invoked directly,
// without a renderer. useCallback returns the fn without calling it — but its
// dependency array is still evaluated as a normal argument, which is exactly
// what surfaces a "referenced before declaration" (TDZ) ordering bug between
// two useCallbacks. This is the class of shell-wiring regression that the
// per-component tests structurally cannot catch.
vi.mock("react", async () => {
  const actual = (await vi.importActual("react")) as any;
  return {
    ...actual,
    useState: (init: any) => {
      const i = stateCall++;
      return [
        i in stateOverrides
          ? stateOverrides[i]
          : typeof init === "function"
            ? init()
            : init,
        noop,
      ];
    },
    useRef: (initial: any) => ({ current: initial }),
    useMemo: (fn: any, deps: any) => {
      memoDeps.push(deps);
      return fn();
    },
    useCallback: (fn: any) => fn,
    useEffect: () => {
      return;
    },
  };
});

const noop = () => {
  return;
};

// every dependency array App hands to useMemo, in render order
const memoDeps: any[][] = [];

// useState values by call order for the next render; App declares
// workspaces first and statuses third
let stateOverrides: Record<number, any> = {};
let stateCall = 0;

// depth-first, source order — this file invokes App() directly, so the tree
// is element objects rather than HTML
const walk = (n: any): any[] =>
  !n || typeof n !== "object"
    ? []
    : Array.isArray(n)
      ? n.flatMap(walk)
      : [n, ...walk(n.props?.children)];

// App's body reads no window/document at render time (all IPC lives in the
// mocked-out effects and callbacks), but provide a stub so nothing incidental
// throws.
(global as any).window = {
  jarvis: {
    ttsVoices: () => Promise.resolve([]),
    ttsModels: () => Promise.resolve([]),
    listHeadModels: () => Promise.resolve([]),
    getNotesDir: () => Promise.resolve(null),
    pickNotesDir: () => Promise.resolve(null),
    clearNotesDir: () => Promise.resolve(null),
    getTodos: () => Promise.resolve({ todos: [], malformed: [] }),
    todoOp: () => Promise.resolve({ ok: true }),
    onTodos: () => () => undefined,
    onShowTodos: () => () => undefined,
    onUserSubmitted: () => () => undefined,
  },
};

describe("App shell", () => {
  beforeEach(() => {
    stateOverrides = {};
    stateCall = 0;
  });

  // the first import loads the whole renderer, three included, which runs
  // past a test timeout while the full suite shares the CPU; every test
  // below reads the cached module
  beforeAll(async () => {
    await import("../src/renderer/App");
  }, 60000);

  it("renders without throwing (guards callback declaration order)", async () => {
    const { default: App } = await import("../src/renderer/App");
    const el = (App as any)({});
    expect(el).toBeTruthy();
    expect(el.type).toBe("div");
  });

  it("declares the ✋ ↻ ⚙ cluster once, not once per showHome branch", async () => {
    const { default: App } = await import("../src/renderer/App");
    const nodes = walk((App as any)({}));
    const refresh = nodes.filter(
      (n: any) => n.props?.title === "Refresh graph (F5)",
    );
    expect(refresh).toHaveLength(1);
  });

  it("declares the ☑ toggle and the to-do panel once each", async () => {
    const { default: App } = await import("../src/renderer/App");
    const { default: TodoToggle } =
      await import("../src/renderer/todos/TodoToggle");
    const nodes = walk((App as any)({}));
    expect(nodes.filter((n: any) => n.type === TodoToggle)).toHaveLength(1);
    expect(nodes.filter((n: any) => n.props?.id === "todos")).toHaveLength(1);
  });

  it("gives the graph the full window, not a flex remainder", async () => {
    const { default: App } = await import("../src/renderer/App");
    const el = (App as any)({});
    expect(el.props.className).toContain("h-full w-full");
    expect(el.props.className).not.toContain("flex-1");
  });

  it("mounts the bezel outside the showHome branch", async () => {
    const { default: App } = await import("../src/renderer/App");
    const { default: Bezel } = await import("../src/renderer/ui/Bezel");
    const nodes = walk((App as any)({}));
    expect(nodes.filter((n: any) => n.type === Bezel)).toHaveLength(1);
  });

  it("leaves the graph reachable under the rail and control wrappers", async () => {
    // both span dead space over a now-full-bleed graph; only their buttons
    // may swallow pointer events
    // NB: this file mocks React's hooks and never imports React itself, so
    // find the wrapper by its own class rather than by inspecting children
    const { default: App } = await import("../src/renderer/App");
    const nodes = walk((App as any)({}));
    const railWrapper = nodes.find(
      (n: any) =>
        typeof n.props?.className === "string" &&
        n.props.className.includes("[&_button]:pointer-events-auto"),
    );
    expect(railWrapper).toBeDefined();
    expect(railWrapper.props.className).toContain("pointer-events-none");
    expect(railWrapper.props.className).toContain(
      "[&_button]:pointer-events-auto",
    );
  });

  it("memoizes on settings fields, never the whole settings object", async () => {
    // `settings.panels` is rewritten on every panel drag and window resize. A
    // memo that depends on the whole object hands ForceGraph a new graphData
    // identity each time, restarting the simulation.
    const { default: App } = await import("../src/renderer/App");
    memoDeps.length = 0;
    (App as any)({});
    const settingsShaped = memoDeps
      .flat()
      .some((d: any) => d && typeof d === "object" && "panels" in d);
    expect(settingsShaped).toBe(false);
  });

  it("offers a clear-the-deck control", async () => {
    const { default: App } = await import("../src/renderer/App");
    const nodes = walk((App as any)({}));
    expect(
      nodes.some((n: any) => n.props?.["data-testid"] === "clear-deck"),
    ).toBe(true);
  });

  describe("Scratch is hidden", () => {
    const ws = (id: string, name: string, extra: any = {}) => ({
      id,
      name,
      rootPath: `/u/${id}`,
      kind: "vault",
      sourceId: "unknown",
      ...extra,
    });
    const all = [
      ws("self", "Main agent", { isSelf: true }),
      ws("scr", "Scratch", { isScratch: true }),
      ws("r", "Repo"),
    ];
    // homeView is App's thirteenth useState
    const render = async (homeView: string) => {
      const { default: App } = await import("../src/renderer/App");
      const { default: GraphSlot } =
        await import("../src/renderer/graph/GraphSlot");
      stateOverrides = { 0: all, 12: homeView };
      stateCall = 0;
      const nodes = walk((App as any)({}));
      // the home views are GraphSlot's render function, which walk never calls
      const slot = nodes.find((n: any) => n.type === GraphSlot);
      return [
        ...nodes,
        ...walk(slot.props.children({ width: 800, height: 600 })),
      ];
    };
    const shown = (nodes: any[], type: any) =>
      nodes
        .filter((n: any) => n.type === type)
        .flatMap((n: any) => n.props.workspaces.map((w: any) => w.name));

    it("leaves Scratch off the rail, the cards, the ring and Fleet", async () => {
      const { default: WorkspaceRail } =
        await import("../src/renderer/home/WorkspaceRail");
      const { default: MissionControl } =
        await import("../src/renderer/home/MissionControl");
      const { default: Ring } = await import("../src/renderer/home/Ring");
      const { default: FleetGraph } =
        await import("../src/renderer/graph/FleetGraph");
      const cards = await render("cards");
      expect(shown(cards, WorkspaceRail)).toEqual(["Repo"]);
      expect(shown(cards, MissionControl)).toEqual(["Repo"]);
      expect(shown(await render("ring"), Ring)).toEqual(["Repo"]);
      expect(shown(await render("fleet"), FleetGraph)).toEqual(["Repo"]);
    });

    it("offers no Scratch project chip on the to-do panel", async () => {
      const nodes = await render("cards");
      const withProjects = nodes.filter((n: any) =>
        Array.isArray(n.props?.projects),
      );
      expect(withProjects.length).toBeGreaterThan(0);
      for (const n of withProjects) expect(n.props.projects).toEqual(["Repo"]);
    });
  });

  describe("home terminal tabs", () => {
    const self = {
      id: "self",
      name: "Main agent",
      rootPath: "/u/main-agent",
      kind: "vault",
      sourceId: "unknown",
      isSelf: true,
    };
    const scratch = {
      id: "scr",
      name: "Scratch",
      rootPath: "/u/scratch",
      kind: "vault",
      sourceId: "unknown",
      isScratch: true,
    };
    const session = (key: string, label: string, live = true) => ({
      key,
      label,
      kind: live ? "idle" : "none",
      live,
      call: "",
      since: 0,
      worktree: false,
    });
    const row = (workspaceId: string, sessions: any[]) => ({
      workspaceId,
      kind: "idle",
      call: "",
      since: 0,
      reads: 0,
      edits: 0,
      sessions,
    });

    const terminalPanel = async (scratchSessions: any[]) => {
      const { default: App } = await import("../src/renderer/App");
      const { defaultSettings } = await import("../src/shared/types");
      const settings = defaultSettings();
      stateOverrides = {
        0: [self, scratch],
        // expanded: home collapses to the inbox strip, which shows no tabs
        4: {
          ...settings,
          panels: {
            ...settings.panels,
            home: {
              ...settings.panels.home,
              terminal: { x: 0, y: 0, w: 600, h: 400, z: 1, collapsed: false },
            },
          },
        },
        2: [
          row("self", [session("self", "main")]),
          row("scr", scratchSessions),
        ],
      };
      stateCall = 0;
      return walk((App as any)({})).find(
        (n: any) => n.props?.id === "terminal",
      );
    };
    const labels = (panel: any) =>
      walk(panel.props.badge)
        .find((n: any) => Array.isArray(n.props?.tabs))
        .props.tabs.map((t: any) => t.label);

    it("shows MAIN alone while scratch has no live session", async () => {
      const panel = await terminalPanel([session("scr", "main", false)]);
      expect(labels(panel)).toEqual(["MAIN"]);
    });

    it("shows SCRATCH beside MAIN for one live scratch session", async () => {
      const panel = await terminalPanel([session("scr#1", "1")]);
      expect(labels(panel)).toEqual(["MAIN", "SCRATCH"]);
    });

    it("numbers several scratch sessions", async () => {
      const panel = await terminalPanel([
        session("scr#1", "1"),
        session("scr#2", "2"),
      ]);
      expect(labels(panel)).toEqual(["MAIN", "SCRATCH 1", "SCRATCH 2"]);
    });

    it("keeps the role word in the title and drops the name", async () => {
      const panel = await terminalPanel([]);
      expect(panel.props.title.startsWith("ORCHESTRATOR")).toBe(true);
      expect(panel.props.title).not.toContain("// MAIN AGENT");
      expect(panel.props.title).not.toContain("//");
    });
  });
});
