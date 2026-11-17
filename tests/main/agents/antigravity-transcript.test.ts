import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  NO_FINAL_MESSAGE,
  TRANSCRIPT_TAIL_BYTES,
  createAntigravityEnrich,
} from "../../../src/main/agents/antigravity-transcript";

const FIXTURES = path.join(__dirname, "../../fixtures/antigravity");
const FIXTURE_ANSWER =
  "Updated [greet.js](file:///C:/work/demo/greet.js) (`Hello` -> `Hi`) and created [notes.txt](file:///C:/work/demo/notes.txt) with `probe`.";

let home: string;
let transcript: string;

const stopBody = (fields: Record<string, unknown> = {}) => ({
  hookEventName: "Stop",
  terminationReason: "NO_TOOL_CALL",
  error: "",
  conversationId: "c1",
  transcriptPath: transcript,
  ...fields,
});

const planner = (content?: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    type: "PLANNER_RESPONSE",
    ...(content === undefined ? {} : { content }),
    ...extra,
  });

const writeTranscript = (text: string) => fs.writeFile(transcript, text);

beforeEach(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), "jarvis-agy-transcript-"));
  const logs = path.join(
    home,
    ".gemini/antigravity-cli/brain/c1/.system_generated/logs",
  );
  await fs.mkdir(logs, { recursive: true });
  transcript = path.join(logs, "transcript_full.jsonl");
});

afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(home, { recursive: true, force: true });
});

describe("createAntigravityEnrich", () => {
  it("reads the last PLANNER_RESPONSE content of the recorded transcript", async () => {
    await fs.copyFile(path.join(FIXTURES, "transcript-tail.jsonl"), transcript);
    const body = stopBody();
    const out = await createAntigravityEnrich(home)(body);
    expect(out).toEqual({ ...body, lastAssistantMessage: FIXTURE_ANSWER });
    expect(body).not.toHaveProperty("lastAssistantMessage");
  });

  it("reads the recorded Stop body's transcript path shape", async () => {
    const stop = JSON.parse(
      await fs.readFile(path.join(FIXTURES, "stop.json"), "utf8"),
    );
    await writeTranscript(planner("done") + "\n");
    const out = await createAntigravityEnrich(home)({
      ...stop,
      transcriptPath: transcript.replace(/\\/g, "/"),
    });
    expect(out.lastAssistantMessage).toBe("done");
  });

  it("skips a later PLANNER_RESPONSE that only calls tools", async () => {
    await writeTranscript(
      [
        planner("the answer"),
        planner(undefined, { tool_calls: [{ name: "read_file", args: {} }] }),
        "",
      ].join("\n"),
    );
    const out = await createAntigravityEnrich(home)(stopBody());
    expect(out.lastAssistantMessage).toBe("the answer");
  });

  it("skips a half-written last line", async () => {
    await writeTranscript(
      planner("complete") + "\n" + planner("partial").slice(0, 20),
    );
    const out = await createAntigravityEnrich(home)(stopBody());
    expect(out.lastAssistantMessage).toBe("complete");
  });

  it("gives NO_FINAL_MESSAGE for a missing file", async () => {
    const out = await createAntigravityEnrich(home)(stopBody());
    expect(out.lastAssistantMessage).toBe(NO_FINAL_MESSAGE);
  });

  it("gives NO_FINAL_MESSAGE for an empty file", async () => {
    await writeTranscript("");
    const out = await createAntigravityEnrich(home)(stopBody());
    expect(out.lastAssistantMessage).toBe(NO_FINAL_MESSAGE);
  });

  it("gives NO_FINAL_MESSAGE when no line has an answer", async () => {
    await writeTranscript(
      [
        JSON.stringify({ type: "GENERIC", content: "Created file." }),
        planner(""),
        planner(undefined, { tool_calls: [] }),
      ].join("\n"),
    );
    const out = await createAntigravityEnrich(home)(stopBody());
    expect(out.lastAssistantMessage).toBe(NO_FINAL_MESSAGE);
  });

  it("does not read a transcript outside the brain folder", async () => {
    const outside = path.join(home, "outside.jsonl");
    await fs.writeFile(outside, planner("secret") + "\n");
    const sneaky = path.join(
      home,
      ".gemini/antigravity-cli/brain/../../outside.jsonl",
    );
    const enrich = createAntigravityEnrich(home);
    for (const transcriptPath of [outside, sneaky, 42, undefined]) {
      const out = await enrich(stopBody({ transcriptPath }));
      expect(out.lastAssistantMessage).toBe(NO_FINAL_MESSAGE);
    }
  });

  it("accepts the brain folder with forward slashes and another drive-letter case", async () => {
    await writeTranscript(planner("slashes") + "\n");
    let mixed = transcript.replace(/\\/g, "/");
    if (/^[a-z]:/i.test(mixed))
      mixed =
        mixed[0] === mixed[0].toUpperCase()
          ? mixed[0].toLowerCase() + mixed.slice(1)
          : mixed[0].toUpperCase() + mixed.slice(1);
    const out = await createAntigravityEnrich(home)(
      stopBody({ transcriptPath: mixed }),
    );
    expect(out.lastAssistantMessage).toBe("slashes");
  });

  it("finds the answer in the last line of a 2 MiB file", async () => {
    const filler = JSON.stringify({
      type: "GENERIC",
      content: "x".repeat(1000),
    });
    const lines = Array(2100).fill(filler);
    await writeTranscript(
      lines.join("\n") + "\n" + planner("at the end") + "\n",
    );
    const out = await createAntigravityEnrich(home)(stopBody());
    expect(out.lastAssistantMessage).toBe("at the end");
  });

  it("reads only the tail, so an answer before it is not seen", async () => {
    const filler = JSON.stringify({
      type: "GENERIC",
      content: "x".repeat(1000),
    });
    const fillerLines = Math.ceil((TRANSCRIPT_TAIL_BYTES * 2) / filler.length);
    await writeTranscript(
      planner("too early") + "\n" + Array(fillerLines).fill(filler).join("\n"),
    );
    const out = await createAntigravityEnrich(home)(stopBody());
    expect(out.lastAssistantMessage).toBe(NO_FINAL_MESSAGE);
  });

  it("returns other bodies unchanged without opening the file", async () => {
    await writeTranscript(planner("unused") + "\n");
    const open = vi.spyOn(fs, "open");
    const enrich = createAntigravityEnrich(home);
    const bodies = [
      stopBody({ hookEventName: "PreToolUse" }),
      stopBody({ terminationReason: "USER_CANCELED" }),
      stopBody({ terminationReason: "MAX_TURNS" }),
      stopBody({ error: "quota exceeded" }),
    ];
    for (const body of bodies) expect(await enrich(body)).toBe(body);
    expect(open).not.toHaveBeenCalled();
  });

  it("reads a Stop body with no error field", async () => {
    await writeTranscript(planner("no error field") + "\n");
    const body: Record<string, unknown> = stopBody();
    delete body.error;
    const out = await createAntigravityEnrich(home)(body);
    expect(out.lastAssistantMessage).toBe("no error field");
  });
});
