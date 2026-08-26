import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createOrchestrator,
  MAX_SAY,
  QUEUE_MAX,
} from "../../src/main/orchestrate";
import type { Workspace, WorkspaceStatus } from "../../src/shared/types";

const workspaces: Workspace[] = [
  {
    id: "d:/jarvis",
    name: "JARVIS",
    rootPath: "D:\\jarvis",
    kind: "code",
    isSelf: true,
  },
  { id: "d:/aero", name: "AeroGraph", rootPath: "D:\\aero", kind: "code" },
  { id: "d:/fin", name: "FinPulse", rootPath: "D:\\fin", kind: "code" },
  {
    id: "d:/vault",
    name: "Obsidian-vault",
    rootPath: "D:\\vault",
    kind: "vault",
  },
];

const status = (over: Partial<WorkspaceStatus>): WorkspaceStatus => ({
  workspaceId: "d:/aero",
  kind: "running",
  call: "Edit(vite.config.ts)",
  since: 0,
  reads: 0,
  edits: 0,
  ...over,
});

function setup(
  over: {
    statuses?: WorkspaceStatus[];
    live?: string[]; // workspace ids with a PTY
    writeFails?: boolean; // PTY died between the probe and the write
    sayFails?: boolean; // no renderer window listening
  } = {},
) {
  const writes: Array<[string, string]> = [];
  const delegated: Array<[string, string]> = [];
  const said: string[] = [];
  const nudges: number[] = [];
  const live = new Set(over.live ?? ["d:/aero"]);
  const orch = createOrchestrator({
    getWorkspaces: () => workspaces,
    snapshot: () => over.statuses ?? [],
    hasPty: (id) => live.has(id),
    write: (id, data) => {
      if (over.writeFails) return false;
      writes.push([id, data]);
      return true;
    },
    markDelegated: (id, by) => {
      delegated.push([id, by]);
    },
    say: (text: string) => {
      if (over.sayFails) return false;
      said.push(text);
      return true;
    },
    nudgeMain: () => {
      nudges.push(Date.now());
    },
  });
  return { orch, writes, delegated, said, nudges };
}

describe("orchestrate.list", () => {
  it("joins every workspace with its status and liveness", () => {
    const { orch } = setup({
      statuses: [
        status({
          workspaceId: "d:/aero",
          kind: "running",
          call: "Edit(vite.config.ts)",
          message: "hi",
          delegatedBy: "JARVIS",
        }),
      ],
      live: ["d:/aero"],
    });
    const out = orch.list();
    expect(out).toHaveLength(4);
    expect(out[1]).toEqual({
      name: "AeroGraph",
      kind: "code",
      status: "running",
      call: "Edit(vite.config.ts)",
      message: "hi",
      live: true,
      delegatedBy: "JARVIS",
    });
    // a workspace with no status entry and no PTY reads as none / not live
    expect(out[2]).toEqual({
      name: "FinPulse",
      kind: "code",
      status: "none",
      call: "",
      message: "",
      live: false,
      delegatedBy: "",
    });
  });
});

describe("orchestrate.send", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  // the CR is a separate, later write so the TUI reads it as Enter, not paste
  it("happy path: marks provenance, writes the prompt, then the CR", () => {
    const { orch, writes, delegated } = setup();
    const out = orch.send("AeroGraph", "run the packaging fix");
    expect(out).toEqual({ ok: true });
    expect(delegated).toEqual([["d:/aero", "JARVIS"]]);
    expect(writes).toEqual([["d:/aero", "run the packaging fix"]]);
    vi.runAllTimers();
    expect(writes).toEqual([
      ["d:/aero", "run the packaging fix"],
      ["d:/aero", "\r"],
    ]);
  });

  it("resolves the target name case-insensitively", () => {
    const { orch, writes } = setup();
    expect(orch.send("aerograph", "x").ok).toBe(true);
    expect(writes).toHaveLength(1);
  });

  it("rejects an unknown workspace, listing the valid names", () => {
    const { orch, writes, delegated } = setup();
    const out = orch.send("NopeCorp", "x");
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toContain("AeroGraph");
    expect(writes).toEqual([]);
    expect(delegated).toEqual([]);
  });

  it("rejects a target with no live PTY", () => {
    const { orch, writes, delegated } = setup({ live: [] });
    const out = orch.send("AeroGraph", "x");
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toContain("no session");
    expect(writes).toEqual([]);
    expect(delegated).toEqual([]);
  });

  it("refuses to send to the orchestrator itself", () => {
    const { orch, writes, delegated } = setup({ live: ["d:/jarvis"] });
    const out = orch.send("JARVIS", "x");
    expect(out.ok).toBe(false);
    expect(writes).toEqual([]);
    expect(delegated).toEqual([]);
  });

  // the vault is an ordinary delegate now that isSelf, not kind, marks the sender
  it("sends to the vault like any other workspace", () => {
    const { orch, writes, delegated } = setup({ live: ["d:/vault"] });
    expect(orch.send("Obsidian-vault", "x")).toEqual({ ok: true });
    expect(delegated).toEqual([["d:/vault", "JARVIS"]]);
    vi.runAllTimers();
    expect(writes).toEqual([
      ["d:/vault", "x"],
      ["d:/vault", "\r"],
    ]);
  });

  // hasPty passes, then the session dies before the write lands
  it("reports failure and marks nothing when the write is not delivered", () => {
    const { orch, delegated } = setup({ writeFails: true });
    const out = orch.send("AeroGraph", "x");
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toContain("ended before delivery");
    expect(delegated).toEqual([]);
  });

  it("rejects an empty prompt", () => {
    const { orch, writes, delegated } = setup();
    const out = orch.send("AeroGraph", "   ");
    expect(out.ok).toBe(false);
    expect(writes).toEqual([]);
    expect(delegated).toEqual([]);
  });
});

describe("orchestrate.publishFinish nudges the main agent", () => {
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
      message: "tests are green",
    });
    expect(nudges).toEqual([]);
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
      message: "tests are green",
    });
  });

  it("returns the oldest first, and each entry only once", async () => {
    const { orch } = setup();
    orch.publishFinish("d:/aero", "first");
    orch.publishFinish("d:/fin", "second");
    expect(await orch.watch(1)).toEqual({
      workspace: "AeroGraph",
      message: "first",
    });
    expect(await orch.watch(1)).toEqual({
      workspace: "FinPulse",
      message: "second",
    });
  });

  it("parks until the next finish arrives", async () => {
    const { orch } = setup();
    const pending = orch.watch(5);
    orch.publishFinish("d:/fin", "done");
    await expect(pending).resolves.toEqual({
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
    await expect(orch.watch(1)).resolves.toEqual({
      workspace: "AeroGraph",
      message: "late",
    });
  });

  it("an aborted watch forgets the waiter, so a later finish still queues", async () => {
    const { orch } = setup();
    const ctl = new AbortController();
    const pending = orch.watch(5, ctl.signal);
    ctl.abort();
    await expect(pending).resolves.toEqual({ timeout: true });
    orch.publishFinish("d:/aero", "late");
    await expect(orch.watch(5)).resolves.toEqual({
      workspace: "AeroGraph",
      message: "late",
    });
  });

  it("parks for nothing when the signal is already aborted", async () => {
    const { orch } = setup();
    const ctl = new AbortController();
    ctl.abort();
    await expect(orch.watch(5, ctl.signal)).resolves.toEqual({ timeout: true });
    orch.publishFinish("d:/aero", "late");
    await expect(orch.watch(5)).resolves.toEqual({
      workspace: "AeroGraph",
      message: "late",
    });
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
    expect(await orch.watch(1)).toEqual({
      workspace: "AeroGraph",
      message: "m1",
    });
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
