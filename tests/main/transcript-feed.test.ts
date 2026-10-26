import { mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  createTranscriptFeed,
  newestTranscript,
} from "../../src/main/transcript-feed";

const prompt = (id: string): string =>
  JSON.stringify({
    type: "user",
    uuid: id,
    message: { role: "user", content: id },
  }) + "\n";

function fakeFile(initial = ""): {
  readFrom: (path: string, offset: number) => Promise<Buffer>;
  append: (text: string | Buffer) => void;
} {
  let content = Buffer.from(initial);
  return {
    readFrom: async (_p, offset) => content.subarray(offset),
    append: (text) => {
      content = Buffer.concat([content, Buffer.from(text)]);
    },
  };
}

const ids = (
  entries: { kind: string; id?: string }[],
): (string | undefined)[] => entries.map((e) => e.id);

describe("createTranscriptFeed", () => {
  it("emits entries from a full first read with reset true", async () => {
    const file = fakeFile(prompt("a") + prompt("b"));
    const emit = vi.fn();
    const feed = createTranscriptFeed(emit, file.readFrom);
    await feed.follow("k", "/t.jsonl");
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit.mock.calls[0][0]).toBe("k");
    expect(ids(emit.mock.calls[0][1])).toEqual(["a", "b"]);
    expect(emit.mock.calls[0][2]).toBe(true);
    feed.stopAll();
  });

  it("keeps a partial line until its newline", async () => {
    const whole = prompt("a");
    const file = fakeFile(whole.slice(0, 20));
    const emit = vi.fn();
    const feed = createTranscriptFeed(emit, file.readFrom);
    await feed.follow("k", "/t.jsonl");
    expect(feed.snapshot("k")).toEqual([]);
    file.append(whole.slice(20));
    await feed.poke("k");
    expect(ids(feed.snapshot("k"))).toEqual(["a"]);
    feed.stopAll();
  });

  it("poke emits only appended lines with reset false", async () => {
    const file = fakeFile(prompt("a"));
    const emit = vi.fn();
    const feed = createTranscriptFeed(emit, file.readFrom);
    await feed.follow("k", "/t.jsonl");
    file.append(prompt("b"));
    await feed.poke("k");
    expect(emit).toHaveBeenCalledTimes(2);
    expect(ids(emit.mock.calls[1][1])).toEqual(["b"]);
    expect(emit.mock.calls[1][2]).toBe(false);
    feed.stopAll();
  });

  it("follow to a new path resets", async () => {
    const file = fakeFile(prompt("a"));
    const emit = vi.fn();
    const feed = createTranscriptFeed(emit, file.readFrom);
    await feed.follow("k", "/one.jsonl");
    await feed.follow("k", "/two.jsonl");
    expect(emit).toHaveBeenCalledTimes(2);
    expect(emit.mock.calls[1][2]).toBe(true);
    expect(ids(emit.mock.calls[1][1])).toEqual(["a"]);
    feed.stopAll();
  });

  it("follow to the same path does not reset", async () => {
    const file = fakeFile(prompt("a"));
    const emit = vi.fn();
    const feed = createTranscriptFeed(emit, file.readFrom);
    await feed.follow("k", "/t.jsonl");
    file.append(prompt("b"));
    await feed.follow("k", "/t.jsonl");
    expect(emit.mock.calls[1][2]).toBe(false);
    expect(ids(emit.mock.calls[1][1])).toEqual(["b"]);
    feed.stopAll();
  });

  it("snapshot holds entries since the last reset", async () => {
    const file = fakeFile(prompt("a"));
    const feed = createTranscriptFeed(vi.fn(), file.readFrom);
    await feed.follow("k", "/one.jsonl");
    file.append(prompt("b"));
    await feed.poke("k");
    expect(ids(feed.snapshot("k"))).toEqual(["a", "b"]);
    await feed.follow("k", "/two.jsonl");
    expect(ids(feed.snapshot("k"))).toEqual(["a", "b"]);
    expect(feed.snapshot("other")).toEqual([]);
    feed.stopAll();
  });

  it("two pokes at once never emit a line twice", async () => {
    const file = fakeFile(prompt("a"));
    const emit = vi.fn();
    const feed = createTranscriptFeed(emit, file.readFrom);
    await feed.follow("k", "/t.jsonl");
    file.append(prompt("b"));
    await Promise.all([feed.poke("k"), feed.poke("k")]);
    expect(ids(feed.snapshot("k"))).toEqual(["a", "b"]);
    feed.stopAll();
  });

  it("emit throwing once does not stop later pokes", async () => {
    const file = fakeFile(prompt("a"));
    const emit = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error("window destroyed");
      })
      .mockImplementation(() => undefined);
    const feed = createTranscriptFeed(emit, file.readFrom);
    await expect(feed.follow("k", "/t.jsonl")).resolves.toBeUndefined();
    file.append(prompt("b"));
    await feed.poke("k");
    expect(ids(emit.mock.calls[1][1])).toEqual(["b"]);
    feed.stopAll();
  });

  it("a read that ends mid-character keeps the character whole", async () => {
    const line = Buffer.from(prompt("é漢🙂"));
    const split = line.indexOf(Buffer.from("漢")) + 1;
    const file = fakeFile();
    file.append(line.subarray(0, split));
    const feed = createTranscriptFeed(vi.fn(), file.readFrom);
    await feed.follow("k", "/t.jsonl");
    file.append(line.subarray(split));
    await feed.poke("k");
    expect(ids(feed.snapshot("k"))).toEqual(["é漢🙂"]);
    feed.stopAll();
  });

  it("starts watching once the file appears", async () => {
    let exists = false;
    const watchFile = vi.fn(() => {
      if (!exists) throw new Error("ENOENT");
      return { close: vi.fn(), on: vi.fn() };
    });
    const file = fakeFile(prompt("a"));
    const readFrom = async (p: string, o: number): Promise<Buffer> => {
      if (!exists) throw new Error("ENOENT");
      return file.readFrom(p, o);
    };
    const feed = createTranscriptFeed(vi.fn(), readFrom, watchFile as never);
    await feed.follow("k", "/t.jsonl");
    exists = true;
    await feed.poke("k");
    expect(watchFile).toHaveBeenCalledTimes(2);
    await feed.poke("k");
    expect(watchFile).toHaveBeenCalledTimes(2);
    feed.stopAll();
  });

  it("follow to a new missing path emits an empty reset", async () => {
    const file = fakeFile(prompt("a"));
    const readFrom = async (p: string, o: number): Promise<Buffer> => {
      if (p === "/gone.jsonl") throw new Error("ENOENT");
      return file.readFrom(p, o);
    };
    const emit = vi.fn();
    const feed = createTranscriptFeed(emit, readFrom);
    await feed.follow("k", "/t.jsonl");
    await feed.follow("k", "/gone.jsonl");
    expect(emit).toHaveBeenCalledTimes(2);
    expect(emit.mock.calls[1]).toEqual(["k", [], true]);
    feed.stopAll();
  });

  it("a missing file emits nothing and does not throw", async () => {
    const emit = vi.fn();
    const feed = createTranscriptFeed(emit);
    await expect(
      feed.follow("k", join(tmpdir(), "jarvis-no-such.jsonl")),
    ).resolves.toBeUndefined();
    expect(emit).not.toHaveBeenCalled();
    feed.stopAll();
  });
});

describe("newestTranscript", () => {
  it("picks the newest jsonl", async () => {
    const dir = mkdtempSync(join(tmpdir(), "jarvis-feed-"));
    try {
      writeFileSync(join(dir, "old.jsonl"), "");
      writeFileSync(join(dir, "new.jsonl"), "");
      writeFileSync(join(dir, "newest.txt"), "");
      utimesSync(join(dir, "old.jsonl"), 1000, 1000);
      utimesSync(join(dir, "new.jsonl"), 2000, 2000);
      expect(await newestTranscript(dir)).toBe(join(dir, "new.jsonl"));
      expect(await newestTranscript(join(dir, "missing"))).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
