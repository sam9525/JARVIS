import { describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  hasTranscript,
  newestNote,
  readBriefing,
  todayLocal,
  transcriptDir,
  writeBriefing,
} from "../../src/main/briefing";

const tmp = () => fs.mkdtemp(path.join(os.tmpdir(), "jarvis-brief-"));

describe("transcriptDir", () => {
  it("escapes the drive colon and every backslash, the way Claude Code does", () => {
    const dir = transcriptDir("C:\\Users\\sam99", "D:\\Obsidian-valut");
    expect(path.basename(dir)).toBe("D--Obsidian-valut");
    expect(dir).toBe(
      path.join("C:\\Users\\sam99", ".claude", "projects", "D--Obsidian-valut"),
    );
  });

  it("matches the main agent's own live folder name", () => {
    const dir = transcriptDir(
      "C:\\Users\\sam99",
      "C:\\Users\\sam99\\AppData\\Roaming\\jarvis\\main-agent",
    );
    expect(path.basename(dir)).toBe(
      "C--Users-sam99-AppData-Roaming-jarvis-main-agent",
    );
  });
});

describe("hasTranscript", () => {
  it("is false for a folder that is not there", async () => {
    expect(await hasTranscript(path.join(await tmp(), "nope"))).toBe(false);
  });

  it("is false for a folder holding no .jsonl", async () => {
    const dir = await tmp();
    await fs.writeFile(path.join(dir, "notes.md"), "x", "utf8");
    expect(await hasTranscript(dir)).toBe(false);
  });

  it("is true as soon as one .jsonl is there", async () => {
    const dir = await tmp();
    await fs.writeFile(path.join(dir, "abc.jsonl"), "{}", "utf8");
    expect(await hasTranscript(dir)).toBe(true);
  });
});

describe("todayLocal", () => {
  it("formats a fixed date as YYYY-MM-DD in local time", () => {
    expect(todayLocal(new Date(2026, 8, 14, 13, 5))).toBe("2026-09-14");
  });

  it("pads a single-digit month and day", () => {
    expect(todayLocal(new Date(2026, 0, 3, 23, 59))).toBe("2026-01-03");
  });
});

describe("newestNote", () => {
  it("is null for a folder that is not there", async () => {
    expect(await newestNote(path.join(await tmp(), "nope"))).toBe(null);
  });

  it("is null for a folder holding no .md", async () => {
    const dir = await tmp();
    await fs.writeFile(path.join(dir, "a.txt"), "x", "utf8");
    expect(await newestNote(dir)).toBe(null);
  });

  it("returns the newest .md by mtime, as an absolute path", async () => {
    const dir = await tmp();
    const older = path.join(dir, "2026-09-10.md");
    const newer = path.join(dir, "2026-09-11.md");
    await fs.writeFile(older, "old", "utf8");
    await fs.writeFile(newer, "new", "utf8");
    await fs.utimes(older, new Date(2026, 8, 10), new Date(2026, 8, 10));
    await fs.utimes(newer, new Date(2026, 8, 11), new Date(2026, 8, 11));
    expect(await newestNote(dir)).toBe(newer);
  });
});

describe("readBriefing / writeBriefing", () => {
  it("reads both nulls when the file is not there", async () => {
    expect(await readBriefing(await tmp())).toEqual({
      notesDir: null,
      lastBriefed: null,
    });
  });

  it("round-trips what was written", async () => {
    const userData = await tmp();
    const b = {
      notesDir: "D:\\Obsidian-valut\\memory\\raw",
      lastBriefed: "2026-09-14",
    };
    await writeBriefing(userData, b);
    expect(await readBriefing(userData)).toEqual(b);
  });

  it("reads both nulls from a corrupt file rather than throwing", async () => {
    const userData = await tmp();
    await fs.writeFile(
      path.join(userData, "jarvis-briefing.json"),
      "{ not json",
      "utf8",
    );
    expect(await readBriefing(userData)).toEqual({
      notesDir: null,
      lastBriefed: null,
    });
  });
});
