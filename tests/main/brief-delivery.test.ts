import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BRIEF_CONFIRM_MS,
  BRIEF_TRIES,
  deliverBriefing,
} from "../../src/main/brief-delivery";

describe("deliverBriefing", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const track = (p: Promise<boolean>) => {
    const out: { value?: boolean } = {};
    void p.then((v) => (out.value = v));
    return out;
  };

  const setup = (quietMs = 5000, hooksHeard = true) => {
    let answer!: (submitted: boolean) => void;
    const outcome = new Promise<boolean>((r) => (answer = r));
    const type = vi.fn(() => true);
    const result = track(
      deliverBriefing({
        type,
        msSinceOutput: () => quietMs,
        hooksHeard: () => hooksHeard,
        outcome,
      }),
    );
    return { type, answer, result };
  };

  it("types once and never again when no hook from the session was heard", async () => {
    const { type, result } = setup(5000, false);
    await vi.advanceTimersByTimeAsync(BRIEF_CONFIRM_MS * 3);
    expect(type).toHaveBeenCalledTimes(1);
    expect(result.value).toBe(false);
  });

  it("types once and confirms on the briefing's own submit", async () => {
    const { type, answer, result } = setup();
    expect(type).toHaveBeenCalledTimes(1);
    answer(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(result.value).toBe(true);
    await vi.advanceTimersByTimeAsync(BRIEF_CONFIRM_MS * 3);
    expect(type).toHaveBeenCalledTimes(1);
  });

  it("retypes a briefing that no submit confirmed", async () => {
    const { type, result } = setup();
    await vi.advanceTimersByTimeAsync(BRIEF_CONFIRM_MS);
    expect(type).toHaveBeenCalledTimes(2);
    expect(result.value).toBeUndefined();
  });

  it("stops without confirming when another prompt starts a turn", async () => {
    const { type, answer, result } = setup();
    answer(false);
    await vi.advanceTimersByTimeAsync(BRIEF_CONFIRM_MS * 3);
    expect(result.value).toBe(false);
    expect(type).toHaveBeenCalledTimes(1);
  });

  it("gives up unconfirmed after the last try", async () => {
    const { type, result } = setup();
    await vi.advanceTimersByTimeAsync(BRIEF_CONFIRM_MS * BRIEF_TRIES);
    expect(type).toHaveBeenCalledTimes(BRIEF_TRIES);
    expect(result.value).toBe(false);
  });

  it("does not type into a terminal that is still painting", async () => {
    const { type, result } = setup(0);
    await vi.advanceTimersByTimeAsync(BRIEF_CONFIRM_MS * 2);
    expect(type).not.toHaveBeenCalled();
    expect(result.value).toBeUndefined();
  });

  it("stops when the terminal is gone", async () => {
    const outcome = new Promise<boolean>(() => undefined);
    const result = track(
      deliverBriefing({
        type: () => false,
        msSinceOutput: () => 5000,
        hooksHeard: () => true,
        outcome,
      }),
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(result.value).toBe(false);
  });
});
