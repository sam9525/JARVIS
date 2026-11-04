import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseTranscriptLine } from "../../src/main/transcript-parse";

const lines = readFileSync("tests/fixtures/transcript/session.jsonl", "utf8")
  .split("\n")
  .filter((l) => l !== "");
const byUuid = (uuid: string): string => {
  const line = lines.find((l) => l.includes(`"uuid":"${uuid}"`));
  if (!line) throw new Error(`no fixture line ${uuid}`);
  return line;
};

afterEach(() => vi.restoreAllMocks());

describe("parseTranscriptLine", () => {
  it("parses a prompt", () => {
    expect(parseTranscriptLine(lines[0])).toEqual([
      { kind: "prompt", id: "u-1", text: "Add a retry to the Edge TTS fetch." },
    ]);
  });

  it("parses a slash command prompt", () => {
    expect(parseTranscriptLine(byUuid("u-2"))).toEqual([
      { kind: "prompt", id: "u-2", text: "/model opus" },
    ]);
  });

  it("turns local command output into a notice", () => {
    expect(parseTranscriptLine(byUuid("u-3"))).toEqual([
      { kind: "notice", id: "u-3", text: "Set model to opus" },
    ]);
    expect(parseTranscriptLine(byUuid("u-3b"))).toEqual([]);
    expect(parseTranscriptLine(byUuid("u-3c"))).toEqual([]);
    expect(parseTranscriptLine(byUuid("s-1"))).toEqual([
      { kind: "notice", id: "s-1", text: "Compacting" },
    ]);
  });

  it("parses an array prompt with an image", () => {
    const line = JSON.stringify({
      type: "user",
      uuid: "u-img",
      message: {
        content: [
          { type: "text", text: "Look at this" },
          { type: "image", source: {} },
        ],
      },
    });
    expect(parseTranscriptLine(line)).toEqual([
      { kind: "prompt", id: "u-img", text: "Look at this\n[image]" },
    ]);
  });

  it("gives each block of one line its own id", () => {
    const line = JSON.stringify({
      type: "assistant",
      uuid: "a-multi",
      message: {
        content: [
          { type: "thinking", thinking: "t" },
          { type: "text", text: "hi" },
          { type: "tool_use", id: "toolu_x", name: "Read", input: {} },
        ],
      },
    });
    const ids = parseTranscriptLine(line).map((e) =>
      e.kind === "result" ? "" : e.id,
    );
    expect(ids).toEqual(["a-multi#0", "a-multi#1", "toolu_x"]);
  });

  it("parses text, thinking and tool_use blocks", () => {
    expect(parseTranscriptLine(byUuid("a-1"))).toEqual([
      { kind: "text", id: "a-1", markdown: "I will add the retry." },
    ]);
    expect(parseTranscriptLine(byUuid("a-2"))).toEqual([
      { kind: "thinking", id: "a-2" },
    ]);
    expect(parseTranscriptLine(byUuid("a-3"))).toEqual([
      {
        kind: "tool",
        id: "toolu_edit",
        name: "Edit",
        input: {
          file_path: "src/main/edge-tts.ts",
          old_string: "a",
          new_string: "b",
        },
      },
    ]);
  });

  it("attaches an Edit patch to its result", () => {
    expect(parseTranscriptLine(byUuid("u-4"))).toEqual([
      {
        kind: "result",
        toolUseId: "toolu_edit",
        isError: false,
        text: "The file has been updated.",
        patch: ["-a", "+b", " keep", "-c", "+d"],
      },
    ]);
  });

  it("turns a Write into an all-added patch", () => {
    expect(parseTranscriptLine(byUuid("u-5"))).toEqual([
      {
        kind: "result",
        toolUseId: "toolu_write",
        isError: false,
        text: "File created",
        patch: ["+one", "+two"],
      },
    ]);
  });

  it("flags an error result and cuts long text", () => {
    expect(parseTranscriptLine(byUuid("u-6"))).toEqual([
      {
        kind: "result",
        toolUseId: "toolu_bash",
        isError: true,
        text: "Exit code 1",
      },
    ]);
    const long = JSON.stringify({
      type: "user",
      uuid: "u-long",
      message: {
        content: [
          { type: "tool_result", tool_use_id: "t", content: "x".repeat(5000) },
        ],
      },
    });
    const [entry] = parseTranscriptLine(long);
    expect(entry.kind === "result" && entry.text.length).toBe(4000);
  });

  it("skips sidechain and meta lines", () => {
    expect(parseTranscriptLine(byUuid("u-7"))).toEqual([]);
    expect(parseTranscriptLine(byUuid("u-8"))).toEqual([]);
    expect(parseTranscriptLine(byUuid("a-5"))).toEqual([]);
  });

  it("skips metadata lines without parsing their bodies", () => {
    const parse = vi.spyOn(JSON, "parse");
    expect(parseTranscriptLine(byUuid("b-1"))).toEqual([]);
    expect(parse).not.toHaveBeenCalled();
  });

  it("skips a bridge-session line", () => {
    const line =
      '{"type":"bridge-session","sessionId":"s","bridgeSessionId":"cse_1","lastSequenceNum":1}';
    expect(parseTranscriptLine(line)).toEqual([]);
  });

  it("maps system subtypes", () => {
    expect(parseTranscriptLine(byUuid("s-2"))).toEqual([
      { kind: "notice", id: "s-2", text: "Conversation compacted" },
    ]);
    expect(parseTranscriptLine(byUuid("s-3"))).toEqual([]);
    expect(parseTranscriptLine(byUuid("s-4"))).toEqual([
      { kind: "unknown", id: "s-4", label: "something_new" },
    ]);
  });

  it("marks an unknown block type", () => {
    expect(parseTranscriptLine(byUuid("a-6"))).toEqual([
      { kind: "unknown", id: "a-6", label: "server_tool_use" },
    ]);
  });

  it("marks an unknown line type", () => {
    expect(parseTranscriptLine(byUuid("p-1"))).toEqual([
      { kind: "unknown", id: "p-1", label: "progress" },
    ]);
  });

  it("returns nothing for a broken line", () => {
    expect(parseTranscriptLine("{not json")).toEqual([]);
    expect(parseTranscriptLine("")).toEqual([]);
  });
});

describe("parseTranscriptLine on real Claude Code lines", () => {
  const real = readFileSync(
    "tests/fixtures/transcript/real-shape.jsonl",
    "utf8",
  )
    .split("\n")
    .filter((l) => l !== "");
  const entries = real.flatMap((l) => parseTranscriptLine(l));

  it("reads the top-level type past nested ones", () => {
    expect(entries.filter((e) => e.kind === "text")).toHaveLength(1);
    expect(entries.find((e) => e.kind === "tool")).toMatchObject({
      id: "toolu_01SSB74e8M6PNMu1eZ8WwoJL",
      name: "Edit",
    });
    expect(entries.find((e) => e.kind === "result")).toMatchObject({
      toolUseId: "toolu_01SSB74e8M6PNMu1eZ8WwoJL",
      patch: [" redacted line", " redacted line", " redacted line"],
    });
    expect(entries.some((e) => e.kind === "unknown")).toBe(false);
  });

  it("skips attachment lines without parsing them", () => {
    const parse = vi.spyOn(JSON, "parse");
    for (const line of real.filter((l) => l.includes('"type":"attachment"')))
      expect(parseTranscriptLine(line)).toEqual([]);
    expect(parse).not.toHaveBeenCalled();
  });

  it("turns a compact summary and an interrupt into notices", () => {
    expect(entries.filter((e) => e.kind === "prompt")).toEqual([]);
    expect(
      entries.flatMap((e) => (e.kind === "notice" ? [e.text] : [])),
    ).toEqual(["Conversation compacted", "Interrupted"]);
  });
});

describe("top-level type scan", () => {
  it("ignores a type inside strings and nested values", () => {
    const line = JSON.stringify({
      a: '"type":"assistant"',
      b: { type: "message" },
      c: [{ type: "x" }],
      type: "user",
      uuid: "u-scan",
      message: { content: "hi" },
    });
    expect(parseTranscriptLine(line)).toEqual([
      { kind: "prompt", id: "u-scan", text: "hi" },
    ]);
  });

  it("gives no patch for an empty structuredPatch", () => {
    const line = JSON.stringify({
      type: "user",
      uuid: "u-empty",
      message: {
        content: [{ type: "tool_result", tool_use_id: "t", content: "ok" }],
      },
      toolUseResult: { structuredPatch: [] },
    });
    expect(parseTranscriptLine(line)).toEqual([
      { kind: "result", toolUseId: "t", isError: false, text: "ok" },
    ]);
  });
});

describe("task notifications", () => {
  const tnLines = readFileSync(
    "tests/fixtures/transcript/task-notification.jsonl",
    "utf8",
  )
    .split("\n")
    .filter((l) => l !== "");
  const byTn = (uuid: string): string => {
    const line = tnLines.find((l) => l.includes(`"uuid":"${uuid}"`));
    if (!line) throw new Error(`no fixture line ${uuid}`);
    return line;
  };
  const userLine = (content: string, origin?: { kind: string }): string =>
    JSON.stringify({
      type: "user",
      uuid: "tn-built",
      isSidechain: false,
      ...(origin ? { origin } : {}),
      message: { role: "user", content },
    });

  it("turns a failed notification into a task entry", () => {
    const [entry] = parseTranscriptLine(byTn("tn-failed"));
    expect(entry).toMatchObject({
      kind: "task",
      id: "tn-failed",
      failed: true,
      summary:
        'Background command "Run the Windows build script" failed with exit code 1',
    });
    if (entry.kind !== "task") throw new Error("not a task entry");
    expect(entry.full.startsWith("<task-notification>")).toBe(true);
    expect(entry.full.endsWith("</task-notification>")).toBe(true);
  });

  it("takes the summary alone from an agent notification", () => {
    const entries = parseTranscriptLine(byTn("tn-agent"));
    expect(entries).toHaveLength(1);
    const [entry] = entries;
    if (entry.kind !== "task") throw new Error("not a task entry");
    expect(entry.failed).toBe(false);
    expect(entry.summary).toBe('Agent "Builder check on admin spec" finished');
    expect(entry.full).toContain("<usage>");
  });

  it("keeps a typed prompt that quotes a block as a prompt", () => {
    const [entry] = parseTranscriptLine(byTn("tn-quoted"));
    expect(entry.kind).toBe("prompt");
  });

  it("keeps a typed prompt that starts with a block as a prompt", () => {
    const [entry] = parseTranscriptLine(byTn("tn-starts"));
    expect(entry.kind).toBe("prompt");
  });

  it("falls back when the summary is missing or empty", () => {
    const noSummary = parseTranscriptLine(
      userLine(
        "<task-notification>\n<status>killed</status>\n</task-notification>",
        { kind: "task-notification" },
      ),
    );
    expect(noSummary[0]).toMatchObject({
      kind: "task",
      summary: "Background task killed",
    });
    const emptySummary = parseTranscriptLine(
      userLine(
        "<task-notification>\n<summary> </summary>\n</task-notification>",
        { kind: "task-notification" },
      ),
    );
    expect(emptySummary[0]).toMatchObject({
      kind: "task",
      summary: "Background task",
    });
  });

  it("counts a line with no origin by its text", () => {
    const [entry] = parseTranscriptLine(
      userLine(
        "<task-notification>\n<status>completed</status>\n<summary>done</summary>\n</task-notification>",
      ),
    );
    expect(entry).toMatchObject({ kind: "task", summary: "done" });
  });
});
