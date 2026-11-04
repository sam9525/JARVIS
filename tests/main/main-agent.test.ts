import { describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  AGENT_GUIDE,
  BRIEF_AFTER_HOUR,
  CLEAR_INPUT,
  FINISH_NUDGE,
  NUDGE_PART_CHARS,
  SETTLE_DEADLINE_MS,
  SETTLE_MS,
  dailyBriefNudge,
  dailyBriefPrompt,
  ensureMainAgent,
  GUIDE_HASH_FILE,
  MAIN_AGENT_MODEL,
  MAIN_AGENT_NAME,
  CLEAR_GAP_MS,
  SUBMIT_GAP_MS,
  mainAgentWorkspace,
  nudgeParts,
  typeNudge,
  withMainAgent,
} from "../../src/main/main-agent";
import { scratchWorkspace } from "../../src/main/scratch";
import type { Workspace } from "../../src/shared/types";

const repo: Workspace = {
  id: "d:/data/program/jarvis",
  name: "JARVIS",
  rootPath: "D:\\data\\Program\\JARVIS",
  kind: "code",
  sourceId: "gitnexus",
  isSelf: true, // what boot used to set — this plan moves it
};

const vault: Workspace = {
  id: "d:/vault",
  name: "vault",
  rootPath: "D:\\vault",
  kind: "vault",
  sourceId: "vault",
};

describe("mainAgentWorkspace", () => {
  it("is a vault-kind workspace so the empty graph never offers indexing", () => {
    const ws = mainAgentWorkspace("D:\\userData\\main-agent");
    expect(ws.kind).toBe("vault");
    expect(ws.sourceId).toBe("unknown");
    expect(ws.name).toBe(MAIN_AGENT_NAME);
    expect(ws.isSelf).toBe(true);
  });

  it("normalizes its id the way every other workspace id is normalized", () => {
    const ws = mainAgentWorkspace("D:\\userData\\Main-Agent");
    expect(ws.id).toBe("d:/userdata/main-agent");
    expect(ws.rootPath).toBe("D:\\userData\\Main-Agent");
  });

  it("launches on sonnet", () => {
    expect(MAIN_AGENT_MODEL).toBe("sonnet");
  });
});

describe("withMainAgent", () => {
  const main = () => mainAgentWorkspace("D:\\userData\\main-agent");
  const scratch = () => scratchWorkspace("D:\\userData\\scratch");

  it("appends Scratch and the main agent and leaves the vault first", () => {
    const list = withMainAgent([vault, repo], main(), scratch());
    expect(list.map((w) => w.name)).toEqual([
      "vault",
      "JARVIS",
      "Scratch",
      "Main Agent",
    ]);
  });

  it("makes the main agent the only isSelf workspace", () => {
    const list = withMainAgent([vault, repo], main(), scratch());
    expect(list.filter((w) => w.isSelf).map((w) => w.name)).toEqual([
      "Main Agent",
    ]);
  });

  it("keeps exactly one isScratch and clears both flags from the others", () => {
    const stray: Workspace = { ...vault, isScratch: true, isSelf: true };
    const list = withMainAgent(
      [stray, repo, scratch(), main()],
      main(),
      scratch(),
    );
    expect(list.filter((w) => w.isScratch).map((w) => w.name)).toEqual([
      "Scratch",
    ]);
    expect(list.filter((w) => w.isSelf).map((w) => w.name)).toEqual([
      "Main Agent",
    ]);
    expect(list).toHaveLength(4);
  });

  it("does not mutate the workspaces it was handed", () => {
    const input = [vault, repo];
    withMainAgent(input, main(), scratch());
    expect(repo.isSelf).toBe(true);
    expect(input).toHaveLength(2);
  });
});

const tmpRoot = async () =>
  path.join(
    await fs.mkdtemp(path.join(os.tmpdir(), "jarvis-agent-")),
    "main-agent",
  );

describe("ensureMainAgent", () => {
  const hashOf = (text: string) =>
    createHash("sha256").update(text).digest("hex");
  const guidePath = (root: string) => path.join(root, "CLAUDE.md");
  const hashPath = (root: string) => path.join(root, GUIDE_HASH_FILE);
  const denied = () => Object.assign(new Error("denied"), { code: "EACCES" });

  it("writes the guide and the hash on a first run, and reports it", async () => {
    const root = await tmpRoot();
    await expect(ensureMainAgent(root)).resolves.toBe(true);
    expect(await fs.readFile(guidePath(root), "utf8")).toBe(AGENT_GUIDE);
    expect(await fs.readFile(hashPath(root), "utf8")).toBe(hashOf(AGENT_GUIDE));
  });

  it("reports nothing on a second run", async () => {
    const root = await tmpRoot();
    await ensureMainAgent(root);
    await expect(ensureMainAgent(root)).resolves.toBe(false);
  });

  it("keeps a hand edit while the source is unchanged", async () => {
    const root = await tmpRoot();
    await ensureMainAgent(root);
    await fs.writeFile(guidePath(root), "edited");
    const hashBefore = await fs.readFile(hashPath(root), "utf8");
    await expect(ensureMainAgent(root)).resolves.toBe(false);
    expect(await fs.readFile(guidePath(root), "utf8")).toBe("edited");
    expect(await fs.readFile(hashPath(root), "utf8")).toBe(hashBefore);
  });

  it("overwrites an old guide that has no hash file", async () => {
    const root = await tmpRoot();
    await fs.mkdir(root, { recursive: true });
    await fs.writeFile(guidePath(root), "old");
    await expect(ensureMainAgent(root)).resolves.toBe(true);
    expect(await fs.readFile(guidePath(root), "utf8")).toBe(AGENT_GUIDE);
  });

  it("overwrites a hand edit when the stored hash differs", async () => {
    const root = await tmpRoot();
    await fs.mkdir(root, { recursive: true });
    await fs.writeFile(guidePath(root), "edited");
    await fs.writeFile(hashPath(root), "stale");
    await expect(ensureMainAgent(root)).resolves.toBe(true);
    expect(await fs.readFile(guidePath(root), "utf8")).toBe(AGENT_GUIDE);
    expect(await fs.readFile(hashPath(root), "utf8")).toBe(hashOf(AGENT_GUIDE));
  });

  it("reads a stored hash with a trailing newline as a match", async () => {
    const root = await tmpRoot();
    await ensureMainAgent(root);
    await fs.writeFile(guidePath(root), "edited");
    await fs.appendFile(hashPath(root), "\n");
    await expect(ensureMainAgent(root)).resolves.toBe(false);
    expect(await fs.readFile(guidePath(root), "utf8")).toBe("edited");
  });

  it("brings back a deleted guide when the hash matches", async () => {
    const root = await tmpRoot();
    await ensureMainAgent(root);
    await fs.rm(guidePath(root));
    await expect(ensureMainAgent(root)).resolves.toBe(true);
    expect(await fs.readFile(guidePath(root), "utf8")).toBe(AGENT_GUIDE);
  });

  it("leaves no new hash when the guide write fails", async () => {
    const root = await tmpRoot();
    const warn = vi.spyOn(console, "warn").mockImplementation(vi.fn());
    const write = vi.spyOn(fs, "writeFile").mockRejectedValueOnce(denied());
    try {
      await expect(ensureMainAgent(root)).resolves.toBe(false);
      expect(warn).toHaveBeenCalled();
      await expect(fs.readFile(hashPath(root), "utf8")).rejects.toMatchObject({
        code: "ENOENT",
      });
    } finally {
      write.mockRestore();
      warn.mockRestore();
    }
  });

  it("still reports true when only the hash write fails", async () => {
    const root = await tmpRoot();
    const warn = vi.spyOn(console, "warn").mockImplementation(vi.fn());
    const realWriteFile = fs.writeFile.bind(fs);
    const write = vi
      .spyOn(fs, "writeFile")
      .mockImplementationOnce(realWriteFile)
      .mockRejectedValueOnce(denied());
    try {
      await expect(ensureMainAgent(root)).resolves.toBe(true);
      expect(warn).toHaveBeenCalled();
      expect(await fs.readFile(guidePath(root), "utf8")).toBe(AGENT_GUIDE);
    } finally {
      write.mockRestore();
      warn.mockRestore();
    }
  });

  it("the worktree merge line names the worktree's commit, not a branch", () => {
    expect(AGENT_GUIDE).not.toContain("<branch>");
    expect(AGENT_GUIDE).toContain("git rev-parse HEAD");
  });

  it("tells the agent to re-arm the watch and to keep the summary spoken", () => {
    expect(AGENT_GUIDE).toContain("jarvis_watch");
    expect(AGENT_GUIDE).toContain("jarvis_say");
  });

  it("tells a fresh agent where the to-do list lives and how to write it", () => {
    expect(AGENT_GUIDE).toContain("jarvis_todos");
    expect(AGENT_GUIDE).toContain("TODO.md");
    expect(AGENT_GUIDE).toContain("YYYY-MM-DD");
  });

  it("checks a task off on the user's agreement or a merge into develop, not a bare finish", () => {
    expect(AGENT_GUIDE).toContain("## Keeping the to-do list current");
    expect(AGENT_GUIDE).toContain("merged into develop also counts");
    expect(AGENT_GUIDE).toContain(
      "only says done, committed or tests pass is not agreement",
    );
    expect(AGENT_GUIDE).toContain("or none clearly");
    expect(AGENT_GUIDE).toContain("each task it clearly covers");
  });

  it("the guide tells the agent how to work a to-do task", () => {
    expect(AGENT_GUIDE).toContain("## Working a to-do task");
    expect(AGENT_GUIDE).toContain("fresh: true");
    expect(AGENT_GUIDE).toContain("jarvis_send");
    expect(AGENT_GUIDE).toContain(
      "A follow-up to what a session already did goes to\nthat session",
    );
    expect(AGENT_GUIDE).toContain("in one `jarvis_send`");
    expect(AGENT_GUIDE).toContain(
      "Use the single-task prompt when only one task is chosen",
    );
    expect(AGENT_GUIDE).toContain("never share a prompt");
  });

  it("the guide carries the session, Scratch, worktree and lookup rules", () => {
    for (const needle of [
      "Scratch",
      "fresh: true",
      "git -C",
      "--ff-only",
      "Note lookup for:",
      "Notes context:",
      "jarvis_close",
      "never by name",
      "trustPrompt",
      "nothing relevant",
      "do not summarise",
    ]) {
      expect(AGENT_GUIDE).toContain(needle);
    }
    for (const needle of [
      'session: "main"',
      'jarvis_launch` with `label: "main"',
      "/clear",
    ]) {
      expect(AGENT_GUIDE).toContain(needle);
    }
    expect(AGENT_GUIDE).not.toContain("is the user's own");
    expect(AGENT_GUIDE).not.toContain("is refused for a code workspace");
    expect(AGENT_GUIDE).not.toContain("clears that session");
    expect(AGENT_GUIDE).not.toContain("refused because the workspace is");
  });

  it("leaves an edited guide alone — the user owns the file after first boot", async () => {
    const root = await tmpRoot();
    await ensureMainAgent(root);
    const file = path.join(root, "CLAUDE.md");
    await fs.writeFile(file, "# mine\n", "utf8");
    await ensureMainAgent(root);
    expect(await fs.readFile(file, "utf8")).toBe("# mine\n");
  });

  it("is safe to call on a folder that already exists", async () => {
    const root = await tmpRoot();
    await ensureMainAgent(root);
    await expect(ensureMainAgent(root)).resolves.toBe(false);
  });

  it("logs non-EEXIST errors but does not reject", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(vi.fn());
    const writeFileSpy = vi
      .spyOn(fs, "writeFile")
      .mockRejectedValueOnce(
        Object.assign(new Error("Permission denied"), { code: "EACCES" }),
      );

    const root = await tmpRoot();
    await expect(ensureMainAgent(root)).resolves.toBe(false);

    expect(warnSpy).toHaveBeenCalledWith(
      "[jarvis] failed to write main-agent guide:",
      expect.any(Error),
    );

    warnSpy.mockRestore();
    writeFileSpy.mockRestore();
  });
});

const LONG_TEXT = "word ".repeat(250).trim();

const NUDGE =
  "A workspace just finished. Call jarvis_watch with timeout_seconds 1, then " +
  "follow Finish summary in your CLAUDE.md. Speak about that one workspace " +
  "alone, in as few words as possible. Never say how many tests passed. Do " +
  "not call jarvis_list.";

describe("FINISH_NUDGE", () => {
  it("is the fixed short text", () => {
    expect(FINISH_NUDGE).toBe(NUDGE);
    expect(FINISH_NUDGE).toHaveLength(239);
  });

  it("fits in one write and on one line", () => {
    expect(FINISH_NUDGE.length).toBeLessThanOrEqual(NUDGE_PART_CHARS);
    expect(FINISH_NUDGE).not.toContain("\n");
  });

  it("names no workspace and carries no message", () => {
    expect(FINISH_NUDGE).not.toContain("{");
  });
});

describe("AGENT_GUIDE Finish summary", () => {
  it("holds every rule that left the nudge", () => {
    expect(AGENT_GUIDE).toContain("## Finish summary");
    for (const needle of [
      "that one workspace alone",
      "as few words as possible",
      "JARVIS review",
      "check by hand",
      "three sentences at most",
      "Never say how many tests passed",
      "all tests pass",
      "how many failed and what they check",
      "skipped",
      "only says some tests passed",
      "say nothing about tests",
      "preamble",
      "no list",
      "file names",
      "test names",
      "markdown",
      "do not call `jarvis_list`",
    ]) {
      expect(AGENT_GUIDE).toContain(needle);
    }
  });

  it("bans a passed-test count before the build rule", () => {
    const section = AGENT_GUIDE.slice(AGENT_GUIDE.indexOf("## Finish summary"));
    expect(section.indexOf("Never say how many tests passed")).toBeLessThan(
      section.indexOf("If it finished a build"),
    );
  });

  it("points the turn steps at the section", () => {
    expect(AGENT_GUIDE.indexOf("## What starts your turn")).toBeLessThan(
      AGENT_GUIDE.indexOf("## Finish summary"),
    );
    expect(AGENT_GUIDE).toContain("Follow Finish summary below.");
  });
});

describe("AGENT_GUIDE describes the nudge, not a watch loop", () => {
  it("carries the working mark and the hand-off rules", () => {
    expect(AGENT_GUIDE).toContain("- [/]");
    expect(AGENT_GUIDE).toContain("check by hand");
    expect(AGENT_GUIDE).toContain(
      "one sentence naming the workspace and the task",
    );
  });

  it("tells the agent it is started by the app rather than by polling", () => {
    expect(AGENT_GUIDE).toContain("jarvis_watch");
    expect(AGENT_GUIDE).toContain("not poll and you do not wait");
  });

  it("scopes the summary to the one finish the turn was woken for", () => {
    expect(AGENT_GUIDE).toContain("that one workspace alone");
    expect(AGENT_GUIDE).toContain("Do not call `jarvis_list` to look for more");
  });

  it("holds the guide and the nudge to the same fewest-words brief", () => {
    expect(AGENT_GUIDE).toContain("as few words as possible");
    expect(AGENT_GUIDE).toContain("Someone is listening, not reading");
  });
});

const notes = [
  "D:\\Obsidian-valut\\memory\\raw\\2026-09-13-Mac.md",
  "D:\\Obsidian-valut\\memory\\raw\\2026-09-13.md",
];

describe("dailyBriefPrompt", () => {
  it("carries every note's path and nothing else about the work", () => {
    const text = dailyBriefPrompt(notes);
    for (const n of notes) expect(text).toContain(n);
    // a location, not a description: swap the path and the rest is identical
    const a = dailyBriefPrompt(["A"]).replace("A", "");
    const b = dailyBriefPrompt(["B"]).replace("B", "");
    expect(a).toBe(b);
  });

  it("asks for three parts: today's top three, open items, decisions and risks", () => {
    const text = dailyBriefPrompt(notes);
    expect(text).toContain("the three things most worth starting today");
    expect(text).toContain("still open or blocked and its next step");
    expect(text).toContain("any decision, new finding or new risk");
    expect(text.indexOf("three things")).toBeLessThan(
      text.indexOf("still open"),
    );
    expect(text.indexOf("still open")).toBeLessThan(text.indexOf("new risk"));
    expect(text).toContain(
      "Mention finished work only when it changes the plan",
    );
    expect(text).toContain("No counts, no commit IDs, no file names");
    expect(text).toContain("Say nothing about a project they do not mention");
    expect(text).not.toContain("one paragraph per project");
    // the main agent's finish summary is the spoken part, not this answer
    expect(text).not.toContain("spoken");
  });

  it("asks the delegate to report a note that is not yesterday's", () => {
    expect(dailyBriefPrompt(notes)).toContain("yesterday's");
  });
});

describe("dailyBriefNudge", () => {
  it("fits on one line, since it is typed into a TUI composer", () => {
    expect(dailyBriefNudge(notes, "My Vault")).not.toContain("\n");
  });

  it("delegates to the vault workspace instead of reading the notes", () => {
    const text = dailyBriefNudge(notes, "My Vault");
    expect(text).toContain("Do not read the notes yourself");
    expect(text).toContain("jarvis_send to My Vault");
    expect(text).toContain("jarvis_launch");
  });

  it("forwards the delegate's prompt verbatim", () => {
    expect(dailyBriefNudge(notes, "My Vault")).toContain(
      dailyBriefPrompt(notes),
    );
  });

  it("leaves the wait to the finish nudge, not jarvis_watch", () => {
    expect(dailyBriefNudge(notes, "My Vault")).not.toContain("jarvis_watch");
  });
});

describe("briefing constants", () => {
  it("holds the briefing until the morning", () => {
    expect(BRIEF_AFTER_HOUR).toBe(7);
  });

  it("waits a second of silence, and gives up after a minute", () => {
    expect(SETTLE_MS).toBe(1000);
    expect(SETTLE_DEADLINE_MS).toBe(60_000);
    expect(SETTLE_DEADLINE_MS).toBeGreaterThan(SETTLE_MS);
  });
});

describe("nudgeParts", () => {
  it("keeps a text of at most 500 characters whole", () => {
    expect(nudgeParts("a".repeat(500))).toEqual(["a".repeat(500)]);
    expect(nudgeParts("hello")).toEqual(["hello"]);
  });

  it("cuts at the last space before 500, and the space starts the next part", () => {
    const text = "word ".repeat(150).trim(); // 749 chars
    const parts = nudgeParts(text);
    expect(parts.length).toBe(2);
    expect(parts.every((p) => p.length <= NUDGE_PART_CHARS)).toBe(true);
    expect(parts[1].startsWith(" ")).toBe(true);
    expect(parts.join("")).toBe(text);
  });

  it("keeps a word longer than the limit whole", () => {
    const text = "x".repeat(600) + " tail";
    const parts = nudgeParts(text);
    expect(parts[0]).toBe("x".repeat(600));
    expect(parts.join("")).toBe(text);
  });

  it("splits a long text into parts of at most 500 that join back", () => {
    const parts = nudgeParts(LONG_TEXT);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.every((p) => p.length <= NUDGE_PART_CHARS)).toBe(true);
    expect(parts.join("")).toBe(LONG_TEXT);
  });
});

describe("typeNudge", () => {
  const recorder = (alive = true) => {
    const writes: string[] = [];
    const write = (data: string) => {
      writes.push(data);
      return alive;
    };
    return { writes, write };
  };

  it("clears the input, then types the nudge, then submits — three writes", () => {
    vi.useFakeTimers();
    const { writes, write } = recorder();
    expect(typeNudge(write, "hello")).toBe(true);
    expect(writes).toEqual([CLEAR_INPUT]);
    vi.advanceTimersByTime(CLEAR_GAP_MS - 1);
    expect(writes).toEqual([CLEAR_INPUT]);
    vi.advanceTimersByTime(1);
    expect(writes).toEqual([CLEAR_INPUT, "hello"]);
    vi.advanceTimersByTime(SUBMIT_GAP_MS);
    expect(writes).toEqual([CLEAR_INPUT, "hello", "\r"]);
    vi.useRealTimers();
  });

  it("types a long nudge as parts 80 ms apart, then Enter", () => {
    vi.useFakeTimers();
    const { writes, write } = recorder();
    const parts = nudgeParts(LONG_TEXT);
    typeNudge(write, LONG_TEXT);
    vi.advanceTimersByTime(CLEAR_GAP_MS);
    expect(writes).toEqual([CLEAR_INPUT, parts[0]]);
    vi.advanceTimersByTime(SUBMIT_GAP_MS);
    expect(writes).toEqual([CLEAR_INPUT, parts[0], parts[1]]);
    vi.runAllTimers();
    expect(writes).toEqual([CLEAR_INPUT, ...parts, "\r"]);
    vi.useRealTimers();
  });

  it("stops the rest and the Enter when a part write fails", () => {
    vi.useFakeTimers();
    const writes: string[] = [];
    let n = 0;
    const write = (d: string) => {
      writes.push(d);
      return ++n < 3; // clear ok, part 1 ok, part 2 fails
    };
    typeNudge(write, LONG_TEXT);
    vi.runAllTimers();
    const parts = nudgeParts(LONG_TEXT);
    expect(writes).toEqual([CLEAR_INPUT, parts[0], parts[1]]);
    vi.useRealTimers();
  });

  it("writes nothing more when there is no session", () => {
    vi.useFakeTimers();
    const { writes, write } = recorder(false);
    expect(typeNudge(write, "hello")).toBe(false);
    vi.runAllTimers();
    expect(writes).toEqual([CLEAR_INPUT]);
    vi.useRealTimers();
  });

  it("clears with editing keys only — nothing that interrupts a turn or answers a dialog", () => {
    // Esc interrupts a running turn and cancels a permission prompt; Ctrl+C
    // interrupts or exits; CR submits
    expect(new Set(CLEAR_INPUT)).toEqual(new Set(["\x15", "\x0b", "\x7f"]));
  });

  it("stays a short chunk, so the TUI reads keys rather than a paste", () => {
    expect(CLEAR_INPUT.length).toBeLessThanOrEqual(30);
  });
});
