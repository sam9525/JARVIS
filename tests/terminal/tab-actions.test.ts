/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  closeSessionTab,
  openSessionTab,
} from "../../src/renderer/terminal/tab-actions";

const ptyClose = vi.fn();
const ptyLaunch = vi.fn();

beforeEach(() => {
  ptyClose.mockReset();
  ptyLaunch.mockReset();
  (global as any).window = { jarvis: { ptyClose, ptyLaunch } };
});

describe("closeSessionTab", () => {
  const deps = () => {
    const order: string[] = [];
    return {
      order,
      deselect: vi.fn((k: string) => order.push(`deselect ${k}`)),
      dispose: vi.fn((k: string) => order.push(`dispose ${k}`)),
      notify: vi.fn(),
    };
  };

  it("falls back off the tab before freeing its terminal", async () => {
    ptyClose.mockResolvedValue({ ok: true });
    const d = deps();
    await closeSessionTab("w#1", d);
    expect(ptyClose).toHaveBeenCalledWith("w#1");
    expect(d.order).toEqual(["deselect w#1", "dispose w#1"]);
    expect(d.notify).not.toHaveBeenCalled();
  });

  it("names a kept worktree", async () => {
    ptyClose.mockResolvedValue({ ok: true, kept: "D:/r/.worktrees/1 (dirty)" });
    const d = deps();
    await closeSessionTab("w#1", d);
    expect(d.notify).toHaveBeenCalledWith(
      "Worktree kept: D:/r/.worktrees/1 (dirty)",
    );
  });

  it("frees nothing when there was nothing to close", async () => {
    ptyClose.mockResolvedValue({ ok: false });
    const d = deps();
    await closeSessionTab("w#1", d);
    expect(d.dispose).not.toHaveBeenCalled();
    expect(d.deselect).not.toHaveBeenCalled();
    expect(d.notify).toHaveBeenCalledWith("Could not close the session");
  });

  it("reports a failed call", async () => {
    ptyClose.mockRejectedValue(new Error("boom"));
    const d = deps();
    await closeSessionTab("w#1", d);
    expect(d.dispose).not.toHaveBeenCalled();
    expect(d.notify.mock.calls[0][0]).toContain("boom");
  });
});

describe("openSessionTab", () => {
  const deps = () => ({ select: vi.fn(), notify: vi.fn() });

  it("opens the next numbered session at the given size and selects it", async () => {
    ptyLaunch.mockResolvedValue({ ok: true, hooksOk: true, key: "w#2" });
    const d = deps();
    await openSessionTab("w", { cols: 120, rows: 40 }, d);
    expect(ptyLaunch).toHaveBeenCalledWith("w", null, 120, 40);
    expect(d.select).toHaveBeenCalledWith("w#2");
    expect(d.notify).not.toHaveBeenCalled();
  });

  it("says so at the cap", async () => {
    ptyLaunch.mockResolvedValue({ ok: false, hooksOk: false, error: "cap" });
    const d = deps();
    await openSessionTab("w", { cols: 80, rows: 24 }, d);
    expect(d.select).not.toHaveBeenCalled();
    expect(d.notify).toHaveBeenCalledWith("4 sessions are already open");
  });

  it("passes any other refusal on", async () => {
    ptyLaunch.mockResolvedValue({ ok: false, hooksOk: false, error: "nope" });
    const d = deps();
    await openSessionTab("w", { cols: 80, rows: 24 }, d);
    expect(d.notify).toHaveBeenCalledWith("Could not open a session: nope");
  });

  it("reports a failed call", async () => {
    ptyLaunch.mockRejectedValue(new Error("spawn"));
    const d = deps();
    await openSessionTab("w", { cols: 80, rows: 24 }, d);
    expect(d.notify.mock.calls[0][0]).toContain("spawn");
  });
});
