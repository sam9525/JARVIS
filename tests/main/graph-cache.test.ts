import { describe, expect, it, vi } from "vitest";
import { cachedGraph } from "../../src/main/graph-cache";
import type { VaultGraph } from "../../src/shared/types";

const ok: VaultGraph = { nodes: [{ id: "a", type: "note" }], edges: [] };
const empty: VaultGraph = { nodes: [], edges: [] };
const failed: VaultGraph = { nodes: [], edges: [], failed: "busy" };
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("cachedGraph", () => {
  it("loads once and serves the cached graph after that", async () => {
    const cache = new Map<string, Promise<VaultGraph>>();
    const load = vi.fn(async () => ok);
    expect(await cachedGraph(cache, "w", load)).toBe(ok);
    expect(await cachedGraph(cache, "w", load)).toBe(ok);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("caches a genuinely empty graph", async () => {
    const cache = new Map<string, Promise<VaultGraph>>();
    const load = vi.fn(async () => empty);
    await cachedGraph(cache, "w", load);
    await flush();
    await cachedGraph(cache, "w", load);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("drops a failed graph, so the next ask loads again", async () => {
    const cache = new Map<string, Promise<VaultGraph>>();
    const load = vi
      .fn<() => Promise<VaultGraph>>()
      .mockResolvedValueOnce(failed)
      .mockResolvedValueOnce(ok);
    expect(await cachedGraph(cache, "w", load)).toBe(failed);
    await flush();
    expect(cache.has("w")).toBe(false);
    expect(await cachedGraph(cache, "w", load)).toBe(ok);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("keeps an entry that replaced the failed load meanwhile", async () => {
    const cache = new Map<string, Promise<VaultGraph>>();
    let fail: (g: VaultGraph) => void = () => undefined;
    void cachedGraph(cache, "w", () => new Promise((r) => (fail = r)));
    const rescanned = Promise.resolve(ok);
    cache.set("w", rescanned); // what the rescan handler does
    fail(failed);
    await flush();
    expect(cache.get("w")).toBe(rescanned);
  });
});
