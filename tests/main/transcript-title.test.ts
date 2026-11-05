import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { readAiTitle, topicWord } from "../../src/main/transcript-title";

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "jarvis-title-"));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true, maxRetries: 5 });
});

describe("readAiTitle", () => {
  it("returns the last ai-title and skips malformed lines", async () => {
    const file = path.join(dir, "t.jsonl");
    await fs.writeFile(
      file,
      [
        JSON.stringify({ type: "user", message: "hi" }),
        JSON.stringify({ type: "ai-title", aiTitle: "First" }),
        "{oops",
        JSON.stringify({ type: "ai-title", aiTitle: "Second" }),
      ].join("\n"),
    );
    expect(await readAiTitle(file)).toBe("Second");
  });

  it("returns null for a missing file", async () => {
    expect(await readAiTitle(path.join(dir, "none.jsonl"))).toBeNull();
  });

  it("returns null when no line is an ai-title", async () => {
    const file = path.join(dir, "t.jsonl");
    await fs.writeFile(file, JSON.stringify({ type: "user" }) + "\n");
    expect(await readAiTitle(file)).toBeNull();
  });
});

describe("topicWord", () => {
  it("takes the first word that is not the workspace name", () => {
    expect(topicWord("Review JARVIS code", "JARVIS")).toBe("review");
    expect(topicWord("JARVIS review", "JARVIS")).toBe("review");
    expect(topicWord("Per-tab session finished summary", "JARVIS")).toBe(
      "per-tab",
    );
  });

  it("returns an empty string when nothing usable is left", () => {
    expect(topicWord("JARVIS", "JARVIS")).toBe("");
    expect(topicWord("!!! ???", "JARVIS")).toBe("");
  });
});
