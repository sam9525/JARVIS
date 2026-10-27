import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createOrchestrator,
  CLOSE_QUIET_MS,
  MAX_SAY,
  QUEUE_MAX,
} from "../../src/main/orchestrate";
import type {
  SessionStatus,
  Workspace,
  WorkspaceStatus,
} from "../../src/shared/types";

const workspaces: Workspace[] = [
  {
    id: "d:/jarvis",
    name: "JARVIS",
    rootPath: "D:\\jarvis",
    kind: "code",
    sourceId: "gitnexus",
    isSelf: true,
  },
  {
    id: "d:/aero",
    name: "AeroGraph",
    rootPath: "D:\\aero",
    kind: "code",
    sourceId: "gitnexus",
  },
  {
    id: "d:/fin",
    name: "FinPulse",
    rootPath: "D:\\fin",
    kind: "code",
    sourceId: "gitnexus",
  },
  {
    id: "d:/vault",
    name: "Obsidian-vault",
    rootPath: "D:\\vault",
    kind: "vault",
    sourceId: "vault",
  },
];

// a code workspace flagged as the Scratch folder; kept out of the default list
const scratchWorkspace: Workspace = {
  ...workspaces[1],
  id: "d:/scratch",
  name: "Scratch",
  isScratch: true,
};

interface Sess {
  key: string;
  workspaceId: string;
  label: string;
  cwd: string;
  worktree: boolean;
}

const mainOf = (id: string): Sess => {
  const ws = [...workspaces, scratchWorkspace].find(
    (w) => w.id === id,
  ) as Workspace;
  return {
    key: id,
    workspaceId: id,
    label: "main",
    cwd: ws.rootPath,
    worktree: false,
  };
};

const worktreeOf = (id: string, label: string): Sess => {
  const ws = [...workspaces, scratchWorkspace].find(
    (w) => w.id === id,
  ) as Workspace;
  return {
    key: `${id}#${label}`,
    workspaceId: id,
    label,
    cwd: `${ws.rootPath}\\.worktrees\\${label}`,
    worktree: true,
  };
};

const sessionRow = (over: Partial<SessionStatus>): SessionStatus => ({
  key: "d:/aero",
  label: "main",
  kind: "idle",
  live: true,
  call: "",
  since: 0,
  worktree: false,
  ...over,
});

const status = (over: Partial<WorkspaceStatus>): WorkspaceStatus => ({
  workspaceId: "d:/aero",
  kind: "working",
  call: "Edit(vite.config.ts)",
  since: 0,
  reads: 0,
  edits: 0,
  sessions: [],
  ...over,
});

function setup(
  over: {
    statuses?: WorkspaceStatus[];
    sessions?: Sess[]; // registered sessions; live unless listed in `dead`
    dead?: string[]; // registered keys whose PTY has exited
    writeFails?: boolean; // PTY died between the probe and the write
    sayFails?: boolean; // no renderer window listening
    launchFails?: boolean; // spawn threw — no claude on PATH
    trusted?: boolean | null; // ~/.claude.json's answer for every folder
    exitsOnKeys?: boolean; // the session exits while JARVIS waits on it
    settles?: boolean; // waitQuiet's result; false = the deadline passed
    outputAgoMs?: number; // msSinceOutput's answer; Infinity = no output seen
    kept?: string; // the folder close leaves on disk
    workspaces?: Workspace[]; // the registry; defaults to the module's list
    pendingInput?: string[]; // keys whose composer holds text the user typed
  } = {},
) {
  const writes: Array<[string, string]> = [];
  const attempted: string[] = []; // every write, delivered or not
  const delegated: Array<[string, string]> = [];
  const said: string[] = [];
  const nudges: number[] = [];
  const named: Array<[string, string]> = [];
  const namedAtWrites: number[] = [];
  const launched: Array<[string, string | undefined]> = [];
  const closed: string[] = [];
  const trustChecked: string[] = [];
  const registered: Sess[] = [...(over.sessions ?? [mainOf("d:/aero")])];
  const live = new Set(
    registered.map((s) => s.key).filter((k) => !over.dead?.includes(k)),
  );
  const orch = createOrchestrator({
    getWorkspaces: () => over.workspaces ?? workspaces,
    snapshot: () => over.statuses ?? [],
    sessionsOf: (id) => registered.filter((s) => s.workspaceId === id),
    hasPty: (key) => live.has(key),
    hasPendingInput: (key) => over.pendingInput?.includes(key) ?? false,
    write: (key, data) => {
      attempted.push(data);
      if (over.writeFails) return false;
      writes.push([key, data]);
      return true;
    },
    markDelegated: (key, by) => {
      delegated.push([key, by]);
    },
    nameSession: (key, word) => {
      // the write count pins that naming precedes the wait marker
      named.push([key, word]);
      namedAtWrites.push(writes.length);
    },
    say: (text: string) => {
      if (over.sayFails) return false;
      said.push(text);
      return true;
    },
    nudgeMain: () => {
      nudges.push(Date.now());
    },
    // the real launch: next free number, a worktree in a code workspace,
    // refused as "cap" at four live sessions
    launch: async (ws, label) => {
      launched.push([ws.id, label]);
      if (over.launchFails) return { ok: false, error: "spawn ENOENT" };
      const mine = registered.filter((s) => s.workspaceId === ws.id);
      if (mine.filter((s) => live.has(s.key)).length >= 4)
        return { ok: false, error: "cap" };
      let n = 1;
      while (mine.some((s) => s.label === String(n))) n++;
      const name = label ?? String(n);
      const s =
        ws.kind === "code"
          ? worktreeOf(ws.id, name)
          : {
              key: `${ws.id}#${name}`,
              workspaceId: ws.id,
              label: name,
              cwd: ws.rootPath,
              worktree: false,
            };
      registered.push(s);
      live.add(s.key);
      return {
        ok: true,
        key: s.key,
        label: s.label,
        ...(s.worktree ? { worktree: s.cwd } : {}),
      };
    },
    close: async (key) => {
      closed.push(key);
      live.delete(key);
      const at = registered.findIndex((s) => s.key === key);
      if (at !== -1) registered.splice(at, 1);
      return over.kept ? { ok: true, kept: over.kept } : { ok: true };
    },
    isTrusted: async (folder) => {
      trustChecked.push(folder);
      return over.trusted === undefined ? true : over.trusted;
    },
    waitQuiet: async (key) => {
      // a marker, so tests pin where the wait starts among the writes
      writes.push([key, "<wait>"]);
      if (over.exitsOnKeys) live.delete(key);
      return over.settles ?? true;
    },
    msSinceOutput: () => over.outputAgoMs ?? Infinity,
  });
  return {
    orch,
    writes,
    attempted,
    delegated,
    named,
    namedAtWrites,
    said,
    nudges,
    launched,
    closed,
    trustChecked,
  };
}

describe("orchestrate.list", () => {
  it("gives a workspace with no session one row, with an empty label", () => {
    const { orch } = setup({ sessions: [] });
    const out = orch.list();
    expect(out).toHaveLength(4);
    expect(out[2]).toEqual({
      name: "FinPulse",
      session: "",
      worktree: "",
      topic: "",
      kind: "code",
      status: "none",
      call: "",
      message: "",
      live: false,
      delegatedBy: "",
    });
  });

  it("gives one row per live session, with its own status and worktree", () => {
    const { orch } = setup({
      sessions: [mainOf("d:/aero"), worktreeOf("d:/aero", "1")],
      statuses: [
        status({
          workspaceId: "d:/aero",
          kind: "working",
          message: "hi",
          delegatedBy: "JARVIS",
          sessions: [
            sessionRow({ key: "d:/aero", label: "main", kind: "idle" }),
            sessionRow({
              key: "d:/aero#1",
              label: "1",
              kind: "working",
              call: "Edit(a.ts)",
              worktree: true,
            }),
          ],
        }),
      ],
    });
    const aero = orch.list().filter((r) => r.name === "AeroGraph");
    expect(aero).toEqual([
      {
        name: "AeroGraph",
        session: "main",
        worktree: "",
        topic: "",
        kind: "code",
        status: "idle",
        call: "",
        message: "hi",
        live: true,
        delegatedBy: "JARVIS",
      },
      {
        name: "AeroGraph",
        session: "1",
        worktree: "D:\\aero\\.worktrees\\1",
        topic: "",
        kind: "code",
        status: "working",
        call: "Edit(a.ts)",
        message: "hi",
        live: true,
        delegatedBy: "JARVIS",
      },
    ]);
  });

  it("leaves out a session whose terminal has exited", () => {
    const { orch } = setup({
      sessions: [mainOf("d:/aero"), worktreeOf("d:/aero", "1")],
      dead: ["d:/aero#1"],
    });
    const aero = orch.list().filter((r) => r.name === "AeroGraph");
    expect(aero.map((r) => r.session)).toEqual(["main"]);
  });
});

describe("orchestrate.send", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  // the CR is a separate, later write so the TUI reads it as Enter, not paste
  it("writes the prompt, then the CR, into the only live session", async () => {
    const { orch, writes, delegated } = setup();
    const out = await orch.send("AeroGraph", "run the packaging fix");
    expect(out).toEqual({ ok: true, session: "main" });
    expect(delegated).toEqual([["d:/aero", "JARVIS"]]);
    expect(writes).toEqual([["d:/aero", "run the packaging fix"]]);
    vi.runAllTimers();
    expect(writes).toEqual([
      ["d:/aero", "run the packaging fix"],
      ["d:/aero", "\r"],
    ]);
  });

  it("writes into the session it names", async () => {
    const { orch, writes, delegated } = setup({
      sessions: [mainOf("d:/aero"), worktreeOf("d:/aero", "2")],
    });
    const out = await orch.send("AeroGraph", "next", { session: "2" });
    expect(out).toEqual({
      ok: true,
      session: "2",
      worktree: "D:\\aero\\.worktrees\\2",
    });
    expect(delegated).toEqual([["d:/aero#2", "JARVIS"]]);
    vi.runAllTimers();
    expect(writes).toEqual([
      ["d:/aero#2", "next"],
      ["d:/aero#2", "\r"],
    ]);
  });

  it("refuses several live sessions with no session named, writing nothing", async () => {
    const { orch, attempted, delegated } = setup({
      sessions: [mainOf("d:/aero"), worktreeOf("d:/aero", "1")],
    });
    const out = await orch.send("AeroGraph", "x");
    expect(out).toEqual({
      ok: false,
      error: "AeroGraph has several sessions — pass session: main, 1",
    });
    expect(attempted).toEqual([]);
    expect(delegated).toEqual([]);
  });

  it("refuses a named session that is not live, listing the live ones", async () => {
    const { orch, attempted } = setup();
    const out = await orch.send("AeroGraph", "x", { session: "7" });
    expect(out.ok).toBe(false);
    expect(!out.ok && out.error).toContain("main");
    expect(attempted).toEqual([]);
  });

  it("resolves the target name case-insensitively", async () => {
    const { orch, writes } = setup();
    expect((await orch.send("aerograph", "x")).ok).toBe(true);
    expect(writes).toHaveLength(1);
  });

  it("rejects an unknown workspace, listing the valid names", async () => {
    const { orch, writes, delegated } = setup();
    const out = await orch.send("NopeCorp", "x");
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toContain("AeroGraph");
    expect(writes).toEqual([]);
    expect(delegated).toEqual([]);
  });

  it("rejects a target with no live session", async () => {
    const { orch, writes, delegated } = setup({ sessions: [] });
    const out = await orch.send("AeroGraph", "x");
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toContain("no session");
    expect(writes).toEqual([]);
    expect(delegated).toEqual([]);
  });

  it("refuses a send while the user has unsent text in that session", async () => {
    const { orch, attempted } = setup({ pendingInput: ["d:/aero"] });
    const out = await orch.send("AeroGraph", "do it", { session: "main" });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toContain("fresh: true");
    expect(attempted).toEqual([]);
  });

  it("refuses to send to the orchestrator itself", async () => {
    const { orch, writes, delegated } = setup({
      sessions: [mainOf("d:/jarvis")],
    });
    expect((await orch.send("JARVIS", "x")).ok).toBe(false);
    expect((await orch.send("JARVIS", "x", { fresh: true })).ok).toBe(false);
    expect(writes).toEqual([]);
    expect(delegated).toEqual([]);
  });

  // the vault is an ordinary delegate now that isSelf, not kind, marks the sender
  it("sends to the vault like any other workspace", async () => {
    const { orch, writes, delegated } = setup({
      sessions: [mainOf("d:/vault")],
    });
    expect(await orch.send("Obsidian-vault", "x")).toEqual({
      ok: true,
      session: "main",
    });
    expect(delegated).toEqual([["d:/vault", "JARVIS"]]);
    vi.runAllTimers();
    expect(writes).toEqual([
      ["d:/vault", "x"],
      ["d:/vault", "\r"],
    ]);
  });

  // hasPty passes, then the session dies before the write lands
  it("reports failure and marks nothing when the write is not delivered", async () => {
    const { orch, delegated } = setup({ writeFails: true });
    const out = await orch.send("AeroGraph", "x");
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toContain("ended before delivery");
    expect(delegated).toEqual([]);
  });

  it("rejects an empty prompt", async () => {
    const { orch, writes, delegated } = setup();
    const out = await orch.send("AeroGraph", "   ");
    expect(out.ok).toBe(false);
    expect(writes).toEqual([]);
    expect(delegated).toEqual([]);
  });
});

describe("orchestrate.send with fresh", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("opens a new session, waits for quiet, then sends the prompt and the CR", async () => {
    const { orch, writes, delegated, launched } = setup();
    const out = orch.send("AeroGraph", "To-do task: x", { fresh: true });
    await vi.runAllTimersAsync();
    expect(await out).toEqual({
      ok: true,
      session: "1",
      worktree: "D:\\aero\\.worktrees\\1",
    });
    // no label: the next free number, never the terminal button's main
    expect(launched).toEqual([["d:/aero", undefined]]);
    expect(delegated).toEqual([["d:/aero#1", "JARVIS"]]);
    expect(writes).toEqual([
      ["d:/aero#1", "<wait>"],
      ["d:/aero#1", "To-do task: x"],
      ["d:/aero#1", "\r"],
    ]);
  });

  it("names the new tab with the cleaned label before the wait", async () => {
    const { orch, named, namedAtWrites, writes, launched } = setup();
    const out = orch.send("AeroGraph", "x", { fresh: true, label: "Tabs now" });
    await vi.runAllTimersAsync();
    expect((await out).ok).toBe(true);
    expect(launched).toEqual([["d:/aero", undefined]]); // key keeps the number
    expect(named).toEqual([["d:/aero#1", "tabs"]]);
    expect(namedAtWrites).toEqual([0]);
    expect(writes[0]).toEqual(["d:/aero#1", "<wait>"]);
  });

  it.each([
    ["the workspace name only", "AeroGraph"],
    ["main", "main"],
    ["blank", "  "],
  ])("names nothing for a label that is %s", async (_why, label) => {
    const { orch, named } = setup();
    const out = orch.send("AeroGraph", "x", { fresh: true, label });
    await vi.runAllTimersAsync();
    expect((await out).ok).toBe(true);
    expect(named).toEqual([]);
  });

  it("names nothing on a plain send to the main session", async () => {
    const { orch, named } = setup();
    const out = orch.send("AeroGraph", "x", { label: "tabs" });
    await vi.runAllTimersAsync();
    expect((await out).ok).toBe(true);
    expect(named).toEqual([]);
  });

  it("names nothing in the Scratch workspace", async () => {
    const { orch, named } = setup({
      workspaces: [...workspaces, scratchWorkspace],
      sessions: [],
    });
    const out = orch.send("Scratch", "x", { fresh: true, label: "tabs" });
    await vi.runAllTimersAsync();
    expect((await out).ok).toBe(true);
    expect(named).toEqual([]);
  });

  it("names the tab even when the folder is untrusted", async () => {
    const { orch, named } = setup({ trusted: false });
    const out = orch.send("AeroGraph", "x", { fresh: true, label: "tabs" });
    await vi.runAllTimersAsync();
    expect(await out).toMatchObject({
      ok: true,
      trustPrompt: expect.any(String),
    });
    expect(named).toEqual([["d:/aero#1", "tabs"]]);
  });

  it("names two fresh sessions with the same word under different keys", async () => {
    const { orch, named } = setup();
    for (let i = 0; i < 2; i++) {
      const out = orch.send("AeroGraph", "x", { fresh: true, label: "auth" });
      await vi.runAllTimersAsync();
      await out;
    }
    expect(named).toEqual([
      ["d:/aero#1", "auth"],
      ["d:/aero#2", "auth"],
    ]);
  });

  it("opens a workspace's first session too", async () => {
    const { orch, launched } = setup({ sessions: [] });
    const out = orch.send("FinPulse", "x", { fresh: true });
    await vi.runAllTimersAsync();
    expect(await out).toMatchObject({ ok: true, session: "1" });
    expect(launched).toEqual([["d:/fin", undefined]]);
  });

  it("leaves a busy session alone, since the prompt goes to a new one", async () => {
    const { orch, writes } = setup({
      statuses: [
        status({
          kind: "working",
          sessions: [sessionRow({ kind: "working" })],
        }),
      ],
    });
    const out = orch.send("AeroGraph", "x", { fresh: true });
    await vi.runAllTimersAsync();
    expect(await out).toMatchObject({ ok: true, session: "1" });
    expect(writes.every(([key]) => key === "d:/aero#1")).toBe(true);
  });

  it("at the cap writes nothing and lists the sessions with their status", async () => {
    const { orch, attempted, delegated } = setup({
      sessions: [
        mainOf("d:/aero"),
        worktreeOf("d:/aero", "1"),
        worktreeOf("d:/aero", "2"),
        worktreeOf("d:/aero", "3"),
      ],
      statuses: [
        status({
          sessions: [
            sessionRow({ key: "d:/aero", label: "main", kind: "idle" }),
            sessionRow({ key: "d:/aero#1", label: "1", kind: "working" }),
            sessionRow({ key: "d:/aero#2", label: "2", kind: "asking" }),
            sessionRow({ key: "d:/aero#3", label: "3", kind: "idle" }),
          ],
        }),
      ],
    });
    const out = orch.send("AeroGraph", "x", { fresh: true });
    await vi.runAllTimersAsync();
    expect(await out).toEqual({
      ok: false,
      error:
        "AeroGraph has 4 sessions: main (idle), 1 (working), 2 (asking), 3 (idle) — ask the user which to close",
    });
    expect(attempted).toEqual([]);
    expect(delegated).toEqual([]);
  });

  it("into an untrusted new worktree returns trustPrompt and writes nothing", async () => {
    const { orch, writes, delegated, trustChecked } = setup({
      trusted: false,
    });
    const out = orch.send("AeroGraph", "x", { fresh: true });
    await vi.runAllTimersAsync();
    expect(await out).toEqual({
      ok: true,
      session: "1",
      worktree: "D:\\aero\\.worktrees\\1",
      trustPrompt: "D:\\aero\\.worktrees\\1",
    });
    // trust is read for the session's own folder, not the workspace root
    expect(trustChecked).toEqual(["D:\\aero\\.worktrees\\1"]);
    expect(writes.filter(([, d]) => d !== "<wait>")).toEqual([]);
    expect(delegated).toEqual([]);
  });

  it("reports a spawn failure and writes nothing", async () => {
    const { orch, attempted } = setup({ launchFails: true });
    const out = orch.send("AeroGraph", "x", { fresh: true });
    await vi.runAllTimersAsync();
    expect(await out).toMatchObject({
      ok: false,
      error: expect.stringContaining("failed to start"),
    });
    expect(attempted).toEqual([]);
  });

  it("does not send the prompt when the new session never settles", async () => {
    const { orch, writes } = setup({ settles: false });
    const out = orch.send("AeroGraph", "x", { fresh: true });
    await vi.runAllTimersAsync();
    expect(await out).toMatchObject({
      ok: false,
      error: expect.stringContaining("did not settle"),
    });
    expect(writes.map(([, d]) => d)).toEqual(["<wait>"]);
  });

  it("reports a new session that exits before the prompt", async () => {
    const { orch, writes } = setup({ exitsOnKeys: true });
    const out = orch.send("AeroGraph", "x", { fresh: true });
    await vi.runAllTimersAsync();
    expect(await out).toMatchObject({
      ok: false,
      error: expect.stringContaining("ended"),
    });
    expect(writes.map(([, d]) => d)).toEqual(["<wait>"]);
  });

  it("keeps send's refusals: unknown, self, empty prompt", async () => {
    const { orch, launched } = setup();
    expect((await orch.send("NopeCorp", "x", { fresh: true })).ok).toBe(false);
    expect((await orch.send("JARVIS", "x", { fresh: true })).ok).toBe(false);
    expect((await orch.send("AeroGraph", " ", { fresh: true })).ok).toBe(false);
    expect(launched).toEqual([]);
  });
});

describe("orchestrate.publishFinish nudges the main agent", () => {
  it("keeps two tabs of one workspace apart, first finish first", async () => {
    const { orch } = setup();
    orch.publishFinish("d:/aero", "built the panel");
    orch.publishFinish("d:/aero#1", "fixed the test");
    await expect(orch.watch(1)).resolves.toEqual({
      workspace: "AeroGraph",
      session: "main",
      message: "built the panel",
    });
    await expect(orch.watch(1)).resolves.toEqual({
      workspace: "AeroGraph",
      session: "1",
      message: "fixed the test",
    });
  });

  it("nudges when nobody is parked, since a queue nobody reads wakes no one", () => {
    const { orch, nudges } = setup();
    orch.publishFinish("d:/aero", "tests are green");
    expect(nudges).toHaveLength(1);
  });

  it("does not nudge a parked watcher — one finish wakes the agent one way", async () => {
    const { orch, nudges } = setup();
    const pending = orch.watch(1);
    orch.publishFinish("d:/aero", "tests are green");
    await expect(pending).resolves.toEqual({
      workspace: "AeroGraph",
      session: "main",
      message: "tests are green",
    });
    expect(nudges).toEqual([]);
  });

  it("carries the finishing session's label", async () => {
    const { orch } = setup();
    orch.publishFinish("d:/aero#2", "merged");
    await expect(orch.watch(1)).resolves.toEqual({
      workspace: "AeroGraph",
      session: "2",
      message: "merged",
    });
  });

  describe("topics", () => {
    const aeroSessions = [mainOf("d:/aero"), worktreeOf("d:/aero", "first")];
    const topicStatus = (topics: Record<string, string>) => [
      status({
        workspaceId: "d:/aero",
        sessions: Object.entries(topics).map(([label, topic]) =>
          sessionRow({ key: `d:/aero#${label}`, label, topic }),
        ),
      }),
    ];

    it("carries the topic on a finish", async () => {
      const { orch } = setup({
        sessions: aeroSessions,
        statuses: topicStatus({ first: "review" }),
      });
      orch.publishFinish("d:/aero#first", "done");
      await expect(orch.watch(1)).resolves.toEqual({
        workspace: "AeroGraph",
        session: "first",
        topic: "review",
        message: "done",
      });
    });

    it("sends to a session named by its topic", async () => {
      const { orch, writes } = setup({
        sessions: aeroSessions,
        statuses: topicStatus({ first: "review" }),
      });
      const out = await orch.send("AeroGraph", "go", { session: "Review" });
      expect(out.ok).toBe(true);
      expect(writes[0][0]).toBe("d:/aero#first");
    });

    it("refuses a topic two sessions share", async () => {
      const { orch } = setup({
        sessions: [
          worktreeOf("d:/aero", "first"),
          worktreeOf("d:/aero", "second"),
        ],
        statuses: topicStatus({ first: "review", second: "review" }),
      });
      const out = await orch.send("AeroGraph", "go", { session: "review" });
      expect(out.ok).toBe(false);
    });

    const twinSessions = [
      worktreeOf("d:/aero", "first"),
      worktreeOf("d:/aero", "second"),
    ];

    it("sends to the name a finish speaks for a shared topic", async () => {
      const { orch, writes } = setup({
        sessions: twinSessions,
        statuses: topicStatus({ first: "review", second: "review" }),
      });
      const out = await orch.send("AeroGraph", "go", {
        session: "review first",
      });
      expect(out.ok).toBe(true);
      expect(writes[0][0]).toBe("d:/aero#first");
    });

    it("closes the session its spoken name picks", async () => {
      const { orch, closed } = setup({
        sessions: twinSessions,
        statuses: topicStatus({ first: "review", second: "review" }),
      });
      const out = await orch.close("AeroGraph", "review second");
      expect(out.ok).toBe(true);
      expect(closed).toEqual(["d:/aero#second"]);
    });

    it("closes a session named by its unique topic", async () => {
      const { orch, closed } = setup({
        sessions: aeroSessions,
        statuses: topicStatus({ first: "review" }),
      });
      const out = await orch.close("AeroGraph", "review");
      expect(out.ok).toBe(true);
      expect(closed).toEqual(["d:/aero#first"]);
    });

    it("names a finish against live sessions only, as the tab does", async () => {
      const { orch } = setup({
        sessions: [worktreeOf("d:/aero", "second")],
        statuses: [
          status({
            workspaceId: "d:/aero",
            sessions: [
              sessionRow({
                key: "d:/aero#first",
                label: "first",
                topic: "review",
                live: false,
              }),
              sessionRow({
                key: "d:/aero#second",
                label: "second",
                topic: "review",
              }),
            ],
          }),
        ],
      });
      orch.publishFinish("d:/aero#second", "done");
      await expect(orch.watch(1)).resolves.toMatchObject({ topic: "review" });
    });

    it("lists the topic", () => {
      const { orch } = setup({
        sessions: aeroSessions,
        statuses: topicStatus({ first: "review" }),
      });
      const rows = orch.list().filter((r) => r.name === "AeroGraph");
      expect(rows.find((r) => r.session === "first")?.topic).toBe("review");
      expect(rows.find((r) => r.session === "main")?.topic).toBe("");
    });
  });

  it("never nudges on the orchestrator's own finish", () => {
    const { orch, nudges } = setup();
    orch.publishFinish("d:/jarvis", "my own turn ended");
    expect(nudges).toEqual([]);
  });

  it("does not nudge on an empty message or an unknown workspace", () => {
    const { orch, nudges } = setup();
    orch.publishFinish("d:/aero", "   ");
    orch.publishFinish("d:/nope", "hi");
    expect(nudges).toEqual([]);
  });

  it("nudges once per finish, so two delegates produce two turns", () => {
    const { orch, nudges } = setup();
    orch.publishFinish("d:/aero", "first");
    orch.publishFinish("d:/fin", "second");
    expect(nudges).toHaveLength(2);
  });
});

describe("orchestrate.watch", () => {
  it("returns a finish that is already queued", async () => {
    const { orch } = setup();
    orch.publishFinish("d:/aero", "tests are green");
    await expect(orch.watch(1)).resolves.toEqual({
      workspace: "AeroGraph",
      session: "main",
      message: "tests are green",
    });
  });

  it("returns the oldest first, and each entry only once", async () => {
    const { orch } = setup();
    orch.publishFinish("d:/aero", "first");
    orch.publishFinish("d:/fin", "second");
    expect(await orch.watch(1)).toMatchObject({
      workspace: "AeroGraph",
      message: "first",
    });
    expect(await orch.watch(1)).toMatchObject({
      workspace: "FinPulse",
      message: "second",
    });
  });

  it("parks until the next finish arrives", async () => {
    const { orch } = setup();
    const pending = orch.watch(5);
    orch.publishFinish("d:/fin", "done");
    await expect(pending).resolves.toMatchObject({
      workspace: "FinPulse",
      message: "done",
    });
  });

  it("times out and forgets the waiter, so a later finish still queues", async () => {
    vi.useFakeTimers();
    const { orch } = setup();
    const pending = orch.watch(1);
    await vi.advanceTimersByTimeAsync(1100);
    await expect(pending).resolves.toEqual({ timeout: true });
    vi.useRealTimers();
    orch.publishFinish("d:/aero", "late");
    await expect(orch.watch(1)).resolves.toMatchObject({ message: "late" });
  });

  it("an aborted watch forgets the waiter, so a later finish still queues", async () => {
    const { orch } = setup();
    const ctl = new AbortController();
    const pending = orch.watch(5, ctl.signal);
    ctl.abort();
    await expect(pending).resolves.toEqual({ timeout: true });
    orch.publishFinish("d:/aero", "late");
    await expect(orch.watch(5)).resolves.toMatchObject({ message: "late" });
  });

  it("parks for nothing when the signal is already aborted", async () => {
    const { orch } = setup();
    const ctl = new AbortController();
    ctl.abort();
    await expect(orch.watch(5, ctl.signal)).resolves.toEqual({ timeout: true });
    orch.publishFinish("d:/aero", "late");
    await expect(orch.watch(5)).resolves.toMatchObject({ message: "late" });
  });

  it("never queues the orchestrator's own finishes", async () => {
    vi.useFakeTimers();
    const { orch } = setup();
    orch.publishFinish("d:/jarvis", "my own turn ended");
    const pending = orch.watch(1);
    await vi.advanceTimersByTimeAsync(1100);
    await expect(pending).resolves.toEqual({ timeout: true });
    vi.useRealTimers();
  });

  it("ignores an empty message and an unknown workspace", async () => {
    vi.useFakeTimers();
    const { orch } = setup();
    orch.publishFinish("d:/aero", "   ");
    orch.publishFinish("d:/nope", "hi");
    const pending = orch.watch(1);
    await vi.advanceTimersByTimeAsync(1100);
    await expect(pending).resolves.toEqual({ timeout: true });
    vi.useRealTimers();
  });

  it("drops the oldest past the cap", async () => {
    const { orch } = setup();
    for (let i = 0; i < QUEUE_MAX + 1; i++)
      orch.publishFinish("d:/aero", `m${i}`);
    expect(await orch.watch(1)).toMatchObject({ message: "m1" });
  });
});

describe("orchestrate.say", () => {
  it("speaks the text", () => {
    const { orch, said } = setup();
    expect(orch.say("build is green")).toEqual({ ok: true });
    expect(said).toEqual(["build is green"]);
  });

  it("refuses empty text", () => {
    const { orch, said } = setup();
    expect(orch.say("  ")).toEqual({ ok: false, error: "empty text" });
    expect(said).toEqual([]);
  });

  it("refuses past the cap, naming it — only a summary is spoken", () => {
    const { orch, said } = setup();
    const out = orch.say("x".repeat(MAX_SAY + 1));
    expect(out.ok).toBe(false);
    expect(!out.ok && out.error).toContain(String(MAX_SAY));
    expect(said).toEqual([]);
  });

  it("errors rather than going silent when no renderer is listening", () => {
    const { orch } = setup({ sayFails: true });
    expect(orch.say("hello").ok).toBe(false);
  });
});

describe("orchestrate.launch", () => {
  it("opens the next numbered session and answers its label", async () => {
    const { orch, launched, writes } = setup({ sessions: [] });
    expect(await orch.launch("finpulse")).toEqual({
      ok: true,
      session: "1",
      worktree: "D:\\fin\\.worktrees\\1",
    });
    expect(launched).toEqual([["d:/fin", undefined]]);
    // the launch waits for the new TUI to go quiet before answering
    expect(writes).toEqual([["d:/fin#1", "<wait>"]]);
  });

  it("passes a label through", async () => {
    const { orch, launched } = setup({ sessions: [mainOf("d:/vault")] });
    expect(await orch.launch("Obsidian-vault", "AeroGraph")).toEqual({
      ok: true,
      session: "AeroGraph",
    });
    expect(launched).toEqual([["d:/vault", "AeroGraph"]]);
  });

  it.each(["main", "MAIN", "Main"])(
    "launches the main-folder session for label %s in a code workspace",
    async (label) => {
      const { orch, launched } = setup({ sessions: [] });
      expect((await orch.launch("FinPulse", label)).ok).toBe(true);
      expect(launched).toEqual([["d:/fin", "main"]]);
    },
  );

  it("refuses main when the main tab is already live", async () => {
    const { orch, launched } = setup({ sessions: [mainOf("d:/aero")] });
    const out = await orch.launch("AeroGraph", "MAIN");
    expect(!out.ok && out.error).toContain("jarvis_send to it");
    expect(launched).toEqual([]);
  });

  it("passes the main label through for a vault workspace", async () => {
    const { orch, launched } = setup({ sessions: [] });
    expect((await orch.launch("Obsidian-vault", "main")).ok).toBe(true);
    expect(launched).toEqual([["d:/vault", "main"]]);
  });

  it("refuses a label whose session is already live", async () => {
    const { orch, launched } = setup({
      sessions: [mainOf("d:/aero"), worktreeOf("d:/aero", "docs")],
    });
    const out = await orch.launch("AeroGraph", "docs");
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toContain("already has a live session");
    expect(launched).toEqual([]);
  });

  it("opens another session beside a live one", async () => {
    const { orch, launched } = setup();
    expect(await orch.launch("AeroGraph")).toMatchObject({
      ok: true,
      session: "1",
    });
    expect(launched).toEqual([["d:/aero", undefined]]);
  });

  it("at the cap refuses and lists the sessions", async () => {
    const { orch } = setup({
      sessions: [
        mainOf("d:/aero"),
        worktreeOf("d:/aero", "1"),
        worktreeOf("d:/aero", "2"),
        worktreeOf("d:/aero", "3"),
      ],
    });
    const out = await orch.launch("AeroGraph");
    expect(out).toEqual({
      ok: false,
      error:
        "AeroGraph has 4 sessions: main (none), 1 (none), 2 (none), 3 (none) — ask the user which to close",
    });
  });

  it("names the rail's workspaces when the target is unknown", async () => {
    const { orch, launched } = setup({ sessions: [] });
    const out = await orch.launch("Nope");
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toContain("AeroGraph");
    expect(launched).toEqual([]);
  });

  it("refuses the orchestrator itself", async () => {
    const { orch, launched } = setup({ sessions: [] });
    expect((await orch.launch("JARVIS")).ok).toBe(false);
    expect(launched).toEqual([]);
  });

  it("reports a spawn failure", async () => {
    const { orch } = setup({ sessions: [], launchFails: true });
    const out = await orch.launch("FinPulse");
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toContain("failed to start");
  });

  it("names the session's own folder when it asks to be trusted", async () => {
    const { orch, trustChecked } = setup({ sessions: [], trusted: false });
    const out = await orch.launch("FinPulse");
    expect(out).toEqual({
      ok: true,
      session: "1",
      worktree: "D:\\fin\\.worktrees\\1",
      trustPrompt: "D:\\fin\\.worktrees\\1",
    });
    expect(trustChecked).toEqual(["D:\\fin\\.worktrees\\1"]);
  });
});

describe("orchestrate.close", () => {
  it("closes the named session and passes on the kept folder", async () => {
    const { orch, closed } = setup({
      sessions: [mainOf("d:/aero"), worktreeOf("d:/aero", "1")],
      kept: "D:\\aero\\.worktrees\\1 (uncommitted changes)",
    });
    expect(await orch.close("AeroGraph", "1")).toEqual({
      ok: true,
      kept: "D:\\aero\\.worktrees\\1 (uncommitted changes)",
    });
    expect(closed).toEqual(["d:/aero#1"]);
  });

  it("answers ok alone when nothing stays on disk", async () => {
    const { orch, closed } = setup();
    expect(await orch.close("AeroGraph", "main")).toEqual({ ok: true });
    expect(closed).toEqual(["d:/aero"]);
  });

  it.each(["working", "asking", "blocked"] as const)(
    "refuses a %s session and closes nothing",
    async (kind) => {
      const { orch, closed } = setup({
        sessions: [mainOf("d:/aero"), worktreeOf("d:/aero", "1")],
        statuses: [
          status({
            sessions: [
              sessionRow({ key: "d:/aero", label: "main", kind: "idle" }),
              sessionRow({ key: "d:/aero#1", label: "1", kind }),
            ],
          }),
        ],
      });
      const out = await orch.close("AeroGraph", "1");
      expect(out.ok).toBe(false);
      if (!out.ok) expect(out.error).toContain(`busy (${kind})`);
      expect(closed).toEqual([]);
    },
  );

  // a long Bash call sends no hook, so staleness can read it idle while it runs
  it("refuses a terminal that printed output within the quiet window", async () => {
    const { orch, closed } = setup({ outputAgoMs: CLOSE_QUIET_MS - 1 });
    const out = await orch.close("AeroGraph", "main");
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toContain("output in the last 2 s");
    expect(closed).toEqual([]);
  });

  it("closes an exited session regardless of its last output", async () => {
    const { orch, closed } = setup({
      sessions: [mainOf("d:/aero"), worktreeOf("d:/aero", "1")],
      dead: ["d:/aero#1"],
      outputAgoMs: 0,
    });
    expect((await orch.close("AeroGraph", "1")).ok).toBe(true);
    expect(closed).toEqual(["d:/aero#1"]);
  });

  it("refuses the orchestrator itself", async () => {
    const { orch, closed } = setup({ sessions: [mainOf("d:/jarvis")] });
    expect((await orch.close("JARVIS", "main")).ok).toBe(false);
    expect(closed).toEqual([]);
  });

  it("refuses an unknown session, listing the open ones", async () => {
    const { orch, closed } = setup();
    const out = await orch.close("AeroGraph", "9");
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toContain("main");
    expect(closed).toEqual([]);
  });

  it("refuses an unknown workspace", async () => {
    const { orch, closed } = setup();
    expect((await orch.close("Nope", "main")).ok).toBe(false);
    expect(closed).toEqual([]);
  });
});

describe("orchestrate.trust", () => {
  it("selects Yes with Down then Enter, as two writes", async () => {
    const { orch, writes } = setup({
      sessions: [mainOf("d:/fin")],
      trusted: false,
    });
    expect(await orch.trust("FinPulse", true)).toEqual({ ok: true });
    expect(writes).toEqual([
      ["d:/fin", "<wait>"],
      ["d:/fin", "\x1b[B"],
      ["d:/fin", "\r"],
    ]);
  });

  it("answers the named session, reading trust for its own folder", async () => {
    const { orch, writes, trustChecked } = setup({
      sessions: [mainOf("d:/fin"), worktreeOf("d:/fin", "1")],
      trusted: false,
    });
    expect(await orch.trust("FinPulse", false, "1")).toEqual({ ok: true });
    expect(trustChecked).toEqual(["D:\\fin\\.worktrees\\1"]);
    expect(writes).toEqual([["d:/fin#1", "\r"]]);
  });

  it("refuses several live sessions with none named", async () => {
    const { orch, writes } = setup({
      sessions: [mainOf("d:/fin"), worktreeOf("d:/fin", "1")],
      trusted: false,
    });
    const out = await orch.trust("FinPulse", true);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toContain("several sessions");
    expect(writes).toEqual([]);
  });

  it("declines with Enter alone, on the highlighted No", async () => {
    const { orch, writes } = setup({
      sessions: [mainOf("d:/fin")],
      trusted: false,
    });
    expect(await orch.trust("FinPulse", false)).toEqual({ ok: true });
    expect(writes).toEqual([["d:/fin", "\r"]]);
  });

  it("sends no keys to a folder that is already trusted", async () => {
    const { orch, writes } = setup({
      sessions: [mainOf("d:/fin")],
      trusted: true,
    });
    const out = await orch.trust("FinPulse", true);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toContain("already trusted");
    expect(writes).toEqual([]);
  });

  it("sends no keys when the trust record cannot be read", async () => {
    const { orch, writes } = setup({
      sessions: [mainOf("d:/fin")],
      trusted: null,
    });
    expect((await orch.trust("FinPulse", true)).ok).toBe(false);
    expect(writes).toEqual([]);
  });

  it("needs a live session", async () => {
    const { orch } = setup({ sessions: [], trusted: false });
    const out = await orch.trust("FinPulse", true);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toContain("launch it first");
  });

  it("reports a session that exited instead of continuing", async () => {
    const { orch } = setup({
      sessions: [mainOf("d:/fin")],
      trusted: false,
      exitsOnKeys: true,
    });
    const out = await orch.trust("FinPulse", true);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toContain("exited");
  });
});
