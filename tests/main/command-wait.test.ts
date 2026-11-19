import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { commandWord, createCommandWait } from "../../src/main/command-wait";
import { parseTranscriptLine } from "../../src/main/transcript-parse";
import type { ScreenEntry } from "../../src/shared/screen-types";

const commandBody = (name: string, message: string, args: string) =>
  `<command-name>${name}</command-name>\n            <command-message>${message}</command-message>\n            <command-args>${args}</command-args>`;

const prompt = (text: string): ScreenEntry => ({
  kind: "prompt",
  id: "p",
  text,
});

describe("commandWord", () => {
  it("returns the leading slash word", () => {
    expect(commandWord("/model claude-fable-5-2")).toBe("/model");
    expect(commandWord("  /clear\n")).toBe("/clear");
  });

  it("returns null for a plain prompt", () => {
    expect(commandWord("run it")).toBeNull();
  });
});

describe("createCommandWait", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const track = (p: Promise<boolean>) => {
    const out: { value?: boolean } = {};
    void p.then((v) => (out.value = v));
    return out;
  };

  it("resolves on the real /model transcript line", async () => {
    const wait = createCommandWait();
    const out = track(wait.expect("k", "/model"));
    const entries = parseTranscriptLine(
      JSON.stringify({
        type: "user",
        uuid: "u1",
        message: {
          role: "user",
          content: commandBody("/model", "model", "claude-fable-5-2"),
        },
      }),
    );
    wait.seen("k", entries, false);
    await vi.advanceTimersByTimeAsync(0);
    expect(out.value).toBe(true);
  });

  it("matches a local_command notice", async () => {
    const wait = createCommandWait();
    const out = track(wait.expect("k", "/model"));
    const entries = parseTranscriptLine(
      JSON.stringify({
        type: "system",
        subtype: "local_command",
        uuid: "s1",
        content: commandBody("/model", "model", "fabel"),
      }),
    );
    wait.seen("k", entries, false);
    await vi.advanceTimersByTimeAsync(0);
    expect(out.value).toBe(true);
  });

  it("resolves on reset", async () => {
    const wait = createCommandWait();
    const out = track(wait.expect("k", "/clear"));
    wait.seen("k", [], true);
    await vi.advanceTimersByTimeAsync(0);
    expect(out.value).toBe(true);
  });

  it("ignores other prompts", async () => {
    const wait = createCommandWait(1000);
    const out = track(wait.expect("k", "/model"));
    wait.seen("k", [prompt("/modelx"), prompt("run the fix")], false);
    await vi.advanceTimersByTimeAsync(999);
    expect(out.value).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(out.value).toBe(false);
  });

  it("ignores other keys", async () => {
    const wait = createCommandWait(1000);
    const out = track(wait.expect("k", "/model"));
    wait.seen("other", [prompt("/model x")], false);
    await vi.advanceTimersByTimeAsync(999);
    expect(out.value).toBeUndefined();
  });

  it("returns false at the deadline", async () => {
    const wait = createCommandWait(1000);
    const out = track(wait.expect("k", "/model"));
    await vi.advanceTimersByTimeAsync(1000);
    expect(out.value).toBe(false);
  });

  it("a second expect cancels the first", async () => {
    const wait = createCommandWait();
    const first = track(wait.expect("k", "/model"));
    const second = track(wait.expect("k", "/clear"));
    await vi.advanceTimersByTimeAsync(0);
    expect(first.value).toBe(false);
    expect(second.value).toBeUndefined();
  });

  it("forget resolves the waiter false and clears the mark", async () => {
    const wait = createCommandWait();
    const out = track(wait.expect("k", "/model"));
    wait.delivered("k");
    wait.forget("k");
    await vi.advanceTimersByTimeAsync(0);
    expect(out.value).toBe(false);
    expect(wait.unconfirmed("k")).toBe(false);
  });

  it("ran clears the mark but leaves the waiter open", async () => {
    const wait = createCommandWait();
    const out = track(wait.expect("k", "/model"));
    wait.delivered("k");
    wait.ran("k");
    expect(wait.unconfirmed("k")).toBe(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(out.value).toBeUndefined();
    wait.seen("k", [prompt("/model x")], false);
    await vi.advanceTimersByTimeAsync(0);
    expect(out.value).toBe(true);
  });

  it("tracks the unconfirmed mark from delivery", () => {
    const wait = createCommandWait();
    expect(wait.unconfirmed("k")).toBe(false);
    wait.delivered("k");
    expect(wait.unconfirmed("k")).toBe(true);
    wait.seen("k", [{ kind: "notice", id: "n", text: "Interrupted" }], false);
    expect(wait.unconfirmed("k")).toBe(true);
    wait.seen("k", [prompt("anything")], false);
    expect(wait.unconfirmed("k")).toBe(false);

    wait.delivered("k");
    wait.seen("k", [], true);
    expect(wait.unconfirmed("k")).toBe(false);

    wait.delivered("k");
    wait.seen("k", [{ kind: "notice", id: "n", text: "/model x" }], false);
    expect(wait.unconfirmed("k")).toBe(false);
  });
});
