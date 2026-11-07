import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BOX_KEY_STEP_PX,
  BOX_MIN_PX,
  BUILT_IN_COMMANDS,
  FLIP_COMMANDS,
  atQuery,
  dragMinHeight,
  fileList,
  flipsToRaw,
  insertAt,
  matchCommands,
  matchFiles,
  pickerFor,
  slashQuery,
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

describe("sendPrompt without a terminal", () => {
  it("sends no CR after a failed text write", async () => {
    const write = vi.fn().mockResolvedValue(false);
    expect(await sendPrompt("k", "hello", write)).toBe(false);
    expect(write.mock.calls).toEqual([["k", "hello"]]);
  });
});

describe("fileList", () => {
  it("adds .md to vault ids", () => {
    expect(fileList(["a/b", "c"], "vault")).toEqual(["a/b.md", "c.md"]);
    expect(fileList(["src/a.ts"], "code")).toEqual(["src/a.ts"]);
  });
});

describe("dragMinHeight", () => {
  it("grows by the distance dragged up, capped by the panel", () => {
    expect(dragMinHeight(54, 100)).toBe(
      "min(154px, min(60cqh, calc(100cqh - 130px)))",
    );
  });
  it("never goes below the default height", () => {
    expect(dragMinHeight(54, -30)).toBe(
      "min(54px, min(60cqh, calc(100cqh - 130px)))",
    );
  });
  it("exposes the default height and the key step", () => {
    expect(BOX_MIN_PX).toBe(54);
    expect(BOX_KEY_STEP_PX).toBe(20);
  });
});

describe("slashQuery", () => {
  it("reads the name being typed", () => {
    expect(slashQuery("/")).toBe("");
    expect(slashQuery("/wri")).toBe("wri");
    expect(slashQuery("/superpowers:w")).toBe("superpowers:w");
  });
  it("is null once the draft is anything but one slash word", () => {
    expect(slashQuery("hello /x")).toBeNull();
    expect(slashQuery("/x y")).toBeNull();
    expect(slashQuery("/x\ny")).toBeNull();
    expect(slashQuery("")).toBeNull();
  });
});

describe("matchCommands", () => {
  const cmd = (name: string) => ({ name, description: "" });
  it("puts a prefix match before a contains match, then the shorter name", () => {
    const list = [
      cmd("my-review"),
      cmd("review-long"),
      cmd("review"),
      cmd("x"),
    ];
    expect(matchCommands(list, "rev").map((c) => c.name)).toEqual([
      "review",
      "review-long",
      "my-review",
    ]);
  });
  it("ignores case", () => {
    expect(matchCommands([cmd("Review")], "REV")).toHaveLength(1);
  });
  it("returns at most 8 rows", () => {
    const list = Array.from({ length: 20 }, (_, i) => cmd(`a${i}`));
    expect(matchCommands(list, "a")).toHaveLength(8);
  });
});

describe("BUILT_IN_COMMANDS", () => {
  it("has no duplicates and includes the flip commands", () => {
    expect(new Set(BUILT_IN_COMMANDS).size).toBe(BUILT_IN_COMMANDS.length);
    for (const name of FLIP_COMMANDS) expect(BUILT_IN_COMMANDS).toContain(name);
    expect(BUILT_IN_COMMANDS).toContain("/init");
  });
});
