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
