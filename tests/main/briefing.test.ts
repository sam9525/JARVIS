import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  hasTranscript,
  newestNote,
  pullNotes,
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

  it("escapes spaces, dots and underscores too", () => {
    const dir = transcriptDir(
      "C:\\Users\\x",
      "C:\\Users\\John.Smith\\my_app 2",
    );
    expect(path.basename(dir)).toBe("C--Users-John-Smith-my-app-2");
  });

  it("escapes a POSIX root's slashes", () => {
    expect(
      path.basename(transcriptDir("/home/x", "/home/x/.config/jarvis")),
    ).toBe("-home-x--config-jarvis");
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

  it("returns the .md with the latest filename date, ignoring mtime", async () => {
    const dir = await tmp();
    const older = path.join(dir, "2026-09-10.md");
    const newer = path.join(dir, "Daily 2026-09-11.md");
    await fs.writeFile(older, "old", "utf8");
    await fs.writeFile(newer, "new", "utf8");
    // a pull touched the older note last
    await fs.utimes(newer, new Date(2026, 8, 11), new Date(2026, 8, 11));
    await fs.utimes(older, new Date(2026, 9, 1), new Date(2026, 9, 1));
    expect(await newestNote(dir)).toBe(newer);
  });

  it("skips .md files with no date in the name", async () => {
    const dir = await tmp();
    await fs.writeFile(path.join(dir, "2026-09-10.md"), "x", "utf8");
    await fs.writeFile(path.join(dir, "inbox.md"), "x", "utf8");
    expect(await newestNote(dir)).toBe(path.join(dir, "2026-09-10.md"));
  });
});

describe("pullNotes", () => {
  const git = (cwd: string, ...args: string[]) =>
    execFileSync("git", args, { cwd, stdio: "ignore" });

  it("fast-forwards the local copy from its remote", async () => {
    const origin = await tmp();
    git(origin, "init", "-q");
    git(origin, "config", "user.email", "t@t");
    git(origin, "config", "user.name", "t");
    await fs.writeFile(path.join(origin, "2026-09-10.md"), "x", "utf8");
    git(origin, "add", ".");
    git(origin, "commit", "-qm", "a");
    const local = path.join(await tmp(), "vault");
    git(origin, "clone", "-q", origin, local);
    await fs.writeFile(path.join(origin, "2026-09-11.md"), "y", "utf8");
    git(origin, "add", ".");
    git(origin, "commit", "-qm", "b");

    await pullNotes(local);
    expect(await newestNote(local)).toBe(path.join(local, "2026-09-11.md"));
  });

  it("resolves for a folder that is not a repo", async () => {
    await expect(pullNotes(await tmp())).resolves.toBeUndefined();
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
