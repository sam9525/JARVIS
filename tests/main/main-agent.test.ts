import { describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  AGENT_GUIDE,
  BRIEF_AFTER_HOUR,
  CLEAR_INPUT,
  FINISH_NUDGE,
  SETTLE_DEADLINE_MS,
  SETTLE_MS,
  dailyBriefNudge,
  dailyBriefPrompt,
  ensureMainAgent,
  MAIN_AGENT_MODEL,
  MAIN_AGENT_NAME,
  CLEAR_GAP_MS,
  SUBMIT_GAP_MS,
  mainAgentWorkspace,
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
  it("creates the folder and writes the standing instruction", async () => {
    const root = await tmpRoot();
    await ensureMainAgent(root);
    const guide = await fs.readFile(path.join(root, "CLAUDE.md"), "utf8");
    expect(guide).toBe(AGENT_GUIDE);
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
    await expect(ensureMainAgent(root)).resolves.toBeUndefined();
  });

  it("logs non-EEXIST errors but does not reject", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(vi.fn());
    const writeFileSpy = vi
      .spyOn(fs, "writeFile")
      .mockRejectedValueOnce(
        Object.assign(new Error("Permission denied"), { code: "EACCES" }),
      );

    const root = await tmpRoot();
    await expect(ensureMainAgent(root)).resolves.toBeUndefined();

    expect(warnSpy).toHaveBeenCalledWith(
      "[jarvis] failed to write main-agent guide:",
      expect.any(Error),
    );

    warnSpy.mockRestore();
    writeFileSpy.mockRestore();
  });
});

describe("FINISH_NUDGE", () => {
  it("asks the agent to name the tab, so two tabs of one project read apart", () => {
    expect(FINISH_NUDGE).toContain("JARVIS review");
    expect(FINISH_NUDGE).not.toContain("tab N");
    expect(FINISH_NUDGE).toContain("main");
  });

  it("names no workspace and carries no message — the agent reads the finish itself", () => {
    expect(FINISH_NUDGE).toContain("jarvis_watch");
    expect(FINISH_NUDGE).not.toContain("{");
  });

  // jarvis_list hands back the whole fleet, and an agent given the whole fleet
  // summarises the whole fleet — the queued finish is the one entry it was
  // woken for
  it("sends the agent to the queued finish, not to the fleet", () => {
    expect(FINISH_NUDGE).toContain("timeout_seconds 1");
    expect(FINISH_NUDGE).toContain("do not call jarvis_list");
  });

  it("asks for a hand-off after a build", () => {
    expect(FINISH_NUDGE).toContain("check by hand");
    expect(FINISH_NUDGE).toContain("three sentences at most");
  });

  // a spoken count means nothing to a listener, and agent-reported counts
  // have been wrong before
  it("bans a passed-test count on every finish, not only after a build", () => {
    expect(FINISH_NUDGE).toContain("Never say how many tests passed");
    expect(
      FINISH_NUDGE.indexOf("Never say how many tests passed"),
    ).toBeLessThan(FINISH_NUDGE.indexOf("If it finished a build"));
  });

  it("asks for a test status after a build: all pass, or what failed", () => {
    expect(FINISH_NUDGE).toContain("all tests pass");
    expect(FINISH_NUDGE).toContain("how many failed and what they check");
    expect(FINISH_NUDGE).toContain("three sentences at most");
  });

  it("says nothing about tests when the report does not clearly say they ran", () => {
    expect(FINISH_NUDGE).toContain("skipped");
    expect(FINISH_NUDGE).toContain("say nothing about tests");
  });

  it("fits on one line, since it is typed into a TUI composer", () => {
    expect(FINISH_NUDGE).not.toContain("\n");
  });

  // the summary is heard, not read: a listener cannot skim, so length is the
  // whole design constraint
  it("asks for the fewest words and rules out the shapes that pad speech", () => {
    expect(FINISH_NUDGE).toContain("as few words as");
    for (const banned of ["preamble", "list", "file names", "markdown"]) {
      expect(FINISH_NUDGE).toContain(banned);
    }
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

  it("asks for a written summary, one paragraph per project", () => {
    const text = dailyBriefPrompt(notes);
    expect(text).toContain("one paragraph per project");
    expect(text).toContain("what moved");
    expect(text).toContain("still open");
    // the main agent's finish summary is the spoken part, not this answer
    expect(text).not.toContain("spoken");
    expect(text).not.toContain("first sentence");
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
