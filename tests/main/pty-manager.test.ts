/* eslint-disable @typescript-eslint/no-empty-function */
import { describe, expect, it, vi } from "vitest";
import {
  CLAUDE_MODELS,
  claudeCommand,
  createPtyManager,
  type PtyLike,
  type SpawnFn,
} from "../../src/main/pty-manager";
import type { Workspace } from "../../src/shared/types";

const ws = (id: string): Workspace => ({
  id,
  name: id,
  rootPath: `D:\\proj\\${id}`,
  kind: "code",
  sourceId: "gitnexus",
});

function fakePty() {
  let dataCb: (d: string) => void = () => {};
  let exitCb: (e: { exitCode: number }) => void = () => {};
  const p: PtyLike & {
    emitData: (d: string) => void;
    emitExit: (c: number) => void;
  } = {
    onData: (cb) => {
      dataCb = cb;
    },
    onExit: (cb) => {
      exitCb = cb;
    },
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    emitData: (d) => dataCb(d),
    emitExit: (c) => exitCb({ exitCode: c }),
  };
  return p;
}

describe("pty-manager", () => {
  it("passes --dangerously-skip-permissions only when asked", () => {
    const calls: string[][] = [];
    const spawn: SpawnFn = (_file, args) => {
      calls.push(args);
      return fakePty();
    };
    const mgr = createPtyManager(spawn, { onData: () => {}, onExit: () => {} });
    mgr.launch(ws("a"), 80, 24);
    mgr.launch(ws("b"), 80, 24, true);
    expect(calls[0]).not.toContain("--dangerously-skip-permissions");
    expect(calls[1]).toContain("--dangerously-skip-permissions");
  });

  it("spawns once per workspace and forwards data/exit with the workspace id", () => {
    const spawned: ReturnType<typeof fakePty>[] = [];
    const spawn: SpawnFn = () => {
      const p = fakePty();
      spawned.push(p);
      return p;
    };
    const onData = vi.fn();
    const onExit = vi.fn();
    const mgr = createPtyManager(spawn, { onData, onExit });

    mgr.launch(ws("a"), 80, 24);
    mgr.launch(ws("a"), 80, 24); // second launch while running = no-op
    expect(spawned).toHaveLength(1);

    spawned[0].emitData("hello");
    expect(onData).toHaveBeenCalledWith("a", "hello");

    spawned[0].emitExit(0);
    expect(onExit).toHaveBeenCalledWith("a", 0);

    mgr.launch(ws("a"), 80, 24); // relaunch after exit spawns again
    expect(spawned).toHaveLength(2);
  });

  it("routes write/resize to the right pty and ignores unknown ids", () => {
    const ptys: Record<string, ReturnType<typeof fakePty>> = {};
    const spawn: SpawnFn = (_f, _a, opts) => {
      const p = fakePty();
      ptys[opts.cwd] = p;
      return p;
    };
    const mgr = createPtyManager(spawn, { onData: vi.fn(), onExit: vi.fn() });
    mgr.launch(ws("a"), 80, 24);
    mgr.launch(ws("b"), 80, 24);

    mgr.write("a", "ls\r");
    expect(ptys["D:\\proj\\a"].write).toHaveBeenCalledWith("ls\r");
    expect(ptys["D:\\proj\\b"].write).not.toHaveBeenCalled();

    mgr.resize("b", 100, 30);
    expect(ptys["D:\\proj\\b"].resize).toHaveBeenCalledWith(100, 30);

    mgr.write("nope", "x"); // no throw
    mgr.resize("nope", 1, 1); // no throw
  });

  it("killAll kills every running pty", () => {
    const ptys: ReturnType<typeof fakePty>[] = [];
    const spawn: SpawnFn = () => {
      const p = fakePty();
      ptys.push(p);
      return p;
    };
    const mgr = createPtyManager(spawn, { onData: vi.fn(), onExit: vi.fn() });
    mgr.launch(ws("a"), 80, 24);
    mgr.launch(ws("b"), 80, 24);
    mgr.killAll();
    expect(ptys[0].kill).toHaveBeenCalled();
    expect(ptys[1].kill).toHaveBeenCalled();
  });

  it("write reports whether a pty actually received the data", () => {
    const mgr = createPtyManager(() => fakePty(), {
      onData: vi.fn(),
      onExit: vi.fn(),
    });
    mgr.launch(ws("a"), 80, 24);
    expect(mgr.write("a", "hi")).toBe(true);
    // regression guard: this used to be a silent no-op
    expect(mgr.write("nope", "hi")).toBe(false);
  });

  it("has() tracks launch and exit", () => {
    const spawned: ReturnType<typeof fakePty>[] = [];
    const spawn: SpawnFn = () => {
      const p = fakePty();
      spawned.push(p);
      return p;
    };
    const mgr = createPtyManager(spawn, { onData: vi.fn(), onExit: vi.fn() });
    expect(mgr.has("a")).toBe(false);
    mgr.launch(ws("a"), 80, 24);
    expect(mgr.has("a")).toBe(true);
    spawned[0].emitExit(0);
    expect(mgr.has("a")).toBe(false);
  });

  it("forwards the resume flag to the command line", () => {
    const calls: string[][] = [];
    const spawn: SpawnFn = (_file, args) => {
      calls.push(args);
      return fakePty();
    };
    const mgr = createPtyManager(spawn, { onData: vi.fn(), onExit: vi.fn() });
    mgr.launch(ws("a"), 80, 24, false, "sonnet");
    mgr.launch(ws("b"), 80, 24, false, "sonnet", true);
    expect(calls[0]).not.toContain("--continue");
    expect(calls[1]).toContain("--continue");
  });
});

describe("claudeCommand model flag", () => {
  it("passes no --model when none is chosen", () => {
    expect(claudeCommand().args).not.toContain("--model");
  });

  it("appends --model for each valid alias", () => {
    for (const m of CLAUDE_MODELS) {
      const { args } = claudeCommand(false, m);
      expect(args.slice(-2)).toEqual(["--model", m]);
    }
  });

  it("drops an unrecognised model, so a renderer bug cannot reach the command line", () => {
    expect(claudeCommand(false, "; rm -rf /").args).not.toContain("--model");
    expect(claudeCommand(false, "").args).not.toContain("--model");
  });

  it("keeps the dangerous flag alongside the model", () => {
    const { args } = claudeCommand(true, "opus");
    expect(args).toContain("--dangerously-skip-permissions");
    expect(args.slice(-2)).toEqual(["--model", "opus"]);
  });

  it("passes --continue only when asked", () => {
    expect(claudeCommand().args).not.toContain("--continue");
    expect(claudeCommand(false, undefined, true).args).toContain("--continue");
  });

  it("keeps --continue alongside the model and the dangerous flag", () => {
    const { args } = claudeCommand(true, "sonnet", true);
    expect(args).toContain("--dangerously-skip-permissions");
    expect(args).toContain("--continue");
    expect(args).toContain("--model");
    expect(args).toContain("sonnet");
  });

  it("still drops an unrecognised model when resuming", () => {
    expect(claudeCommand(false, "; rm -rf /", true).args).not.toContain(
      "--model",
    );
  });
});
