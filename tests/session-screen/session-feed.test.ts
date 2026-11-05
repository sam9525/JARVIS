/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeAll } from "vitest";
import type { ScreenEntry } from "../../src/shared/screen-types";
import type { StatusLineView } from "../../src/shared/types";

const pushTranscript = vi.hoisted(() => ({
  cb: null as
    null | ((key: string, entries: ScreenEntry[], reset: boolean) => void),
}));
const pushStatus = vi.hoisted(() => ({
  cb: null as null | ((key: string, view: StatusLineView | null) => void),
}));
const getTranscript = vi.fn(async (_key: string): Promise<ScreenEntry[]> => [
  { kind: "prompt", id: "p1", text: "hi" },
]);

beforeAll(() => {
  (globalThis as any).window = {
    jarvis: {
      getTranscript,
      getStatusLine: async () => null,
      onTranscript: (cb: any) => {
        pushTranscript.cb = cb;
        return () => undefined;
      },
      onStatusLine: (cb: any) => {
        pushStatus.cb = cb;
        return () => undefined;
      },
    },
  };
});

import {
  itemsFor,
  loadSession,
  modelOf,
  onSessionFeed,
  statusLineFor,
} from "../../src/renderer/session-screen/session-feed";

const view = (model: string): StatusLineView => ({
  model,
  effort: "",
  folder: "",
  branch: "",
  commit: "",
  contextPct: null,
  fiveHourPct: null,
  fiveHourResetsAt: null,
  sevenDayPct: null,
  sevenDayResetsAt: null,
});

describe("session feed", () => {
  it("loads a session once and folds later pushes into it", async () => {
    const seen: string[] = [];
    const off = onSessionFeed((k) => seen.push(k));
    loadSession("k1");
    loadSession("k1");
    await Promise.resolve();
    await Promise.resolve();
    expect(getTranscript).toHaveBeenCalledTimes(1);
    expect(itemsFor("k1").map((i) => i.id)).toEqual(["p1"]);

    pushTranscript.cb!(
      "k1",
      [{ kind: "prompt", id: "p2", text: "again" }],
      false,
    );
    expect(itemsFor("k1").map((i) => i.id)).toEqual(["p1", "p2"]);

    pushStatus.cb!("k1", view("Opus 4.7"));
    expect(statusLineFor("k1")?.model).toBe("Opus 4.7");
    expect(seen.every((k) => k === "k1")).toBe(true);
    off();
  });

  it("keeps a pushed status line over a late empty snapshot", async () => {
    loadSession("k2");
    pushStatus.cb!("k2", view("Sonnet"));
    await Promise.resolve();
    await Promise.resolve();
    expect(statusLineFor("k2")?.model).toBe("Sonnet");
  });

  it("forgets a stopped session so a reused key reloads", async () => {
    loadSession("k3");
    await Promise.resolve();
    await Promise.resolve();
    pushStatus.cb!("k3", view("Opus"));
    expect(itemsFor("k3")).toHaveLength(1);

    pushTranscript.cb!("k3", [], true);
    pushStatus.cb!("k3", null);
    expect(itemsFor("k3")).toEqual([]);
    expect(statusLineFor("k3")).toBeNull();

    const calls = getTranscript.mock.calls.length;
    loadSession("k3");
    expect(getTranscript).toHaveBeenCalledTimes(calls + 1);
  });

  it("reads the picker's model value from the status line", () => {
    expect(modelOf(view("Claude Opus 4.7 (1M context)"))).toBe("opus");
    expect(modelOf(view("Haiku 4.5"))).toBe("haiku");
    expect(modelOf(view("something else"))).toBe("");
    expect(modelOf(null)).toBe("");
  });
});
