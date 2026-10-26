import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { listTranscripts } from "../../src/main/transcript-list";

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "jarvis-list-"));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true, maxRetries: 5 });
});

const user = (content: unknown) =>
  JSON.stringify({ type: "user", message: { role: "user", content } });

describe("listTranscripts", () => {
  it("lists newest first with title and prompt count", async () => {
    const older = path.join(dir, "aaa.jsonl");
    const newer = path.join(dir, "bbb.jsonl");
    await fs.writeFile(
      older,
      [user("one"), user([{ type: "tool_result" }])].join("\n"),
    );
    await fs.writeFile(
      newer,
      [
        user("a"),
        user("b"),
        JSON.stringify({ type: "ai-title", aiTitle: "Fix login" }),
      ].join("\n"),
    );
    await fs.writeFile(path.join(dir, "notes.txt"), "ignored");
    await fs.utimes(older, new Date(1_000_000), new Date(1_000_000));
    await fs.utimes(newer, new Date(2_000_000), new Date(2_000_000));

    const list = await listTranscripts(dir);

    expect(list).toEqual([
      { sessionId: "bbb", title: "Fix login", mtime: 2_000_000, prompts: 2 },
      { sessionId: "aaa", title: "", mtime: 1_000_000, prompts: 1 },
    ]);
  });

  it("returns [] for a missing folder", async () => {
    expect(await listTranscripts(path.join(dir, "nope"))).toEqual([]);
  });

  it("keeps only the newest `limit`", async () => {
    for (const n of ["a", "b", "c"]) {
      const file = path.join(dir, `${n}.jsonl`);
      await fs.writeFile(file, user("x"));
      const t = new Date("abc".indexOf(n) * 1000 + 1000);
      await fs.utimes(file, t, t);
    }
    const list = await listTranscripts(dir, 2);
    expect(list.map((t) => t.sessionId)).toEqual(["c", "b"]);
  });
});
