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
});
