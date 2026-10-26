import { afterEach, describe, expect, it, vi } from "vitest";
import {
  atQuery,
  fileList,
  flipsToRaw,
  insertAt,
  matchFiles,
  pickerFor,
  sendPrompt,
} from "../../src/renderer/session-screen/composer-logic";

afterEach(() => vi.useRealTimers());

describe("atQuery", () => {
  it("finds @edg at the caret", () => {
    const text = "Check how @edg";
    expect(atQuery(text, text.length)).toEqual({ start: 10, query: "edg" });
  });
  it("ignores an email address", () => {
    const text = "mail me@example.com";
    expect(atQuery(text, text.length)).toBeNull();
  });
  it("null after a space", () => {
    const text = "see @edge now";
    expect(atQuery(text, text.length)).toBeNull();
  });
});

describe("matchFiles", () => {
  it("ranks shorter paths first", () => {
    const files = [
      "src/main/edge-tts.ts",
      "edge.ts",
      "tests/main/edge-tts.test.ts",
      "a.ts",
    ];
    expect(matchFiles(files, "EDGE")).toEqual([
      "edge.ts",
      "src/main/edge-tts.ts",
      "tests/main/edge-tts.test.ts",
    ]);
  });
  it("honours the limit", () => {
    expect(matchFiles(["a1", "a2", "a3"], "a", 2)).toHaveLength(2);
  });
});

describe("insertAt", () => {
  it("replaces the query and adds a space", () => {
    expect(insertAt("Check @edg", 6, 10, "src/edge.ts")).toEqual({
      text: "Check @src/edge.ts ",
      caret: 19,
    });
  });
});

describe("pickerFor", () => {
  it("opens for the bare commands only", () => {
    expect(pickerFor("/model")).toBe("model");
    expect(pickerFor(" /resume ")).toBe("resume");
    expect(pickerFor("/model sonnet")).toBeNull();
  });
});

describe("flipsToRaw", () => {
  it("flags the commands that need the raw terminal", () => {
    expect(flipsToRaw("/config")).toBe(true);
    expect(flipsToRaw("/compact")).toBe(false);
    expect(flipsToRaw("/review x")).toBe(false);
  });
});

describe("sendPrompt", () => {
  it("writes text then CR as two writes 80 ms apart", async () => {
    vi.useFakeTimers();
    const write = vi.fn().mockResolvedValue(true);
    const done = sendPrompt("k", "hello", write);
    await vi.advanceTimersByTimeAsync(79);
    expect(write.mock.calls).toEqual([["k", "hello"]]);
    await vi.advanceTimersByTimeAsync(1);
    expect(write.mock.calls).toEqual([
      ["k", "hello"],
      ["k", "\r"],
    ]);
    expect(await done).toBe(true);
  });
  it("reports a send into a dead session", async () => {
    vi.useFakeTimers();
    const write = vi.fn().mockResolvedValue(false);
    const done = sendPrompt("k", "hello", write);
    await vi.advanceTimersByTimeAsync(80);
    expect(await done).toBe(false);
  });
});

describe("fileList", () => {
  it("adds .md to vault ids", () => {
    expect(fileList(["a/b", "c"], "vault")).toEqual(["a/b.md", "c.md"]);
    expect(fileList(["src/a.ts"], "code")).toEqual(["src/a.ts"]);
  });
});
