import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSettle } from "../../src/main/settle";

describe("createSettle", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const track = (p: Promise<boolean>) => {
    const out: { value?: boolean } = {};
    void p.then((v) => (out.value = v));
    return out;
  };

  it("does not resolve while the session keeps painting", async () => {
    const settle = createSettle(1000);
    const out = track(settle.wait("a", 60_000));
    for (let i = 0; i < 5; i++) {
      settle.bump("a");
      await vi.advanceTimersByTimeAsync(900);
    }
    expect(out.value).toBeUndefined();
    await vi.advanceTimersByTimeAsync(100);
    expect(out.value).toBe(true);
  });

  it("starts no timer before the first chunk", async () => {
    const settle = createSettle(1000);
    const out = track(settle.wait("a", 60_000));
    await vi.advanceTimersByTimeAsync(5000);
    expect(out.value).toBeUndefined();
  });

  it("answers false at the deadline", async () => {
    const settle = createSettle(1000);
    const out = track(settle.wait("a", 3000));
    const busy = setInterval(() => settle.bump("a"), 500);
    await vi.advanceTimersByTimeAsync(3000);
    clearInterval(busy);
    expect(out.value).toBe(false);
  });

  it("keeps each workspace's wait separate", async () => {
    const settle = createSettle(1000);
    const a = track(settle.wait("a", 60_000));
    const b = track(settle.wait("b", 60_000));
    settle.bump("a");
    await vi.advanceTimersByTimeAsync(1000);
    expect(a.value).toBe(true);
    expect(b.value).toBeUndefined();
  });

  it("ignores output from a workspace nobody waits on", async () => {
    const settle = createSettle(1000);
    settle.bump("a");
    const out = track(settle.wait("a", 60_000));
    await vi.advanceTimersByTimeAsync(2000);
    expect(out.value).toBeUndefined();
  });
});
