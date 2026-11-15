import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createReadyGate } from "../../../src/main/agents/ready-gate";

describe("ready gate", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts a session at starting", () => {
    const gate = createReadyGate();
    gate.open("k");
    expect(gate.state("k")).toBe("starting");
  });

  it("the first hook makes it ready and releases a waiter", async () => {
    const gate = createReadyGate();
    gate.open("k");
    const waiting = gate.wait("k", 1000);
    gate.note("k", "SessionStart");
    expect(gate.state("k")).toBe("ready");
    await expect(waiting).resolves.toBe(true);
  });

  it("a prompt moves ready to used, and used stays used", () => {
    const gate = createReadyGate();
    gate.open("k");
    gate.note("k", "SessionStart");
    gate.note("k", "PreToolUse");
    expect(gate.state("k")).toBe("ready");
    gate.note("k", "UserPromptSubmit");
    expect(gate.state("k")).toBe("used");
    gate.note("k", "PreToolUse");
    expect(gate.state("k")).toBe("used");
  });

  it("a prompt as the first hook makes it used", () => {
    const gate = createReadyGate();
    gate.open("k");
    gate.note("k", "UserPromptSubmit");
    expect(gate.state("k")).toBe("used");
  });

  it("open resets a known key to starting", () => {
    const gate = createReadyGate();
    gate.open("k");
    gate.note("k", "SessionStart");
    gate.open("k");
    expect(gate.state("k")).toBe("starting");
  });

  it("a silent session times out only at the deadline", async () => {
    const gate = createReadyGate();
    gate.open("k");
    let result: boolean | undefined;
    void gate.wait("k", 1000).then((r) => (result = r));
    await vi.advanceTimersByTimeAsync(999);
    expect(result).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(result).toBe(false);
  });

  it("wait on a ready key resolves true at once", async () => {
    const gate = createReadyGate();
    gate.open("k");
    gate.note("k", "SessionStart");
    await expect(gate.wait("k", 1000)).resolves.toBe(true);
  });

  it("an unknown key has no state and wait resolves false at once", async () => {
    const gate = createReadyGate();
    expect(gate.state("unknown")).toBeUndefined();
    await expect(gate.wait("unknown", 1000)).resolves.toBe(false);
  });

  it("note on a never-opened key leaves it unknown", () => {
    const gate = createReadyGate();
    gate.note("k", "SessionStart");
    expect(gate.state("k")).toBeUndefined();
  });

  it("forget resolves a pending wait with false and clears the state", async () => {
    const gate = createReadyGate();
    gate.open("k");
    const waiting = gate.wait("k", 1000);
    gate.forget("k");
    await expect(waiting).resolves.toBe(false);
    expect(gate.state("k")).toBeUndefined();
  });

  it("two waiters on one key both resolve and leave no timer", async () => {
    const gate = createReadyGate();
    gate.open("k");
    const first = gate.wait("k", 1000);
    const second = gate.wait("k", 5000);
    gate.note("k", "SessionStart");
    await expect(Promise.all([first, second])).resolves.toEqual([true, true]);
    expect(vi.getTimerCount()).toBe(0);
  });
});
