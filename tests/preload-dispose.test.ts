/* eslint-disable @typescript-eslint/no-explicit-any */
import { vi, describe, it, expect } from "vitest";

const handlers = new Map<string, Set<(...a: any[]) => void>>();
const exposed: any = {};

vi.mock("electron", () => ({
  contextBridge: {
    exposeInMainWorld: (_k: string, api: any) => Object.assign(exposed, api),
  },
  ipcRenderer: {
    invoke: async () => undefined,
    send: () => undefined,
    on: (ch: string, fn: (...a: any[]) => void) => {
      if (!handlers.has(ch)) handlers.set(ch, new Set());
      handlers.get(ch)!.add(fn);
    },
    removeListener: (ch: string, fn: (...a: any[]) => void) => {
      handlers.get(ch)?.delete(fn);
    },
  },
}));

describe("preload subscriptions", () => {
  it("hands back a disposer that actually removes the listener", async () => {
    await import("../src/main/preload");

    const seen: string[] = [];
    const off = exposed.onStatus(() => seen.push("hit"));
    expect(handlers.get("status")!.size).toBe(1);

    expect(typeof off).toBe("function");
    off();
    expect(handlers.get("status")!.size).toBe(0);
  });
});
