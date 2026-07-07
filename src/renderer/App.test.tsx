import { expect, test, vi } from "vitest";

// Mock window.jarvis
Object.defineProperty(global, "window", {
  value: {
    jarvis: {
      onGraph: vi.fn(),
      onToolEvent: vi.fn(),
      readNote: vi.fn(),
    },
  },
  writable: true,
});

vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return {
    ...actual,
    useState: (init: unknown) => [
      typeof init === "function" ? (init as () => unknown)() : init,
      vi.fn(),
    ],
    useEffect: (fn: () => void) => fn(),
  };
});

import App from "./App";

test("App is a function and returns a React element", () => {
  expect(typeof App).toBe("function");
  const element = App();
  expect(element).toBeDefined();
  expect(element.type).toBe("pre");
});