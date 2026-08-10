/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-empty-function */
import { vi, describe, it, expect } from "vitest";

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
    useState: (init: any) => [typeof init === "function" ? init() : init, noop],
    useRef: (initial: any) => ({ current: initial }),
    useMemo: (fn: any) => fn(),
    useCallback: (fn: any) => fn,
    useEffect: () => {
      return;
    },
  };
});

const noop = () => {
  return;
};

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
(global as any).window = { jarvis: {} };

describe("App shell", () => {
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

  it("offers a clear-the-deck control", async () => {
    const { default: App } = await import("../src/renderer/App");
    const nodes = walk((App as any)({}));
    expect(
      nodes.some((n: any) => n.props?.["data-testid"] === "clear-deck"),
    ).toBe(true);
  });

  it("still renders with no panel geometry saved (defaults resolve)", async () => {
    const { default: App } = await import("../src/renderer/App");
    expect((App as any)({})).toBeTruthy();
  });
});
