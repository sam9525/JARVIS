/* eslint-disable @typescript-eslint/no-empty-function */
import { describe, expect, it, vi } from "vitest";
import {
  createPtyManager,
  type PtyLike,
  type SpawnFn,
} from "../src/main/pty-manager";
import type { Workspace } from "../src/shared/types";

const ws = (id: string): Workspace => ({
  id,
  name: id,
  rootPath: `D:\\proj\\${id}`,
  kind: "code",
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
    expect(mgr.isRunning("a")).toBe(true);

    spawned[0].emitData("hello");
    expect(onData).toHaveBeenCalledWith("a", "hello");

    spawned[0].emitExit(0);
    expect(onExit).toHaveBeenCalledWith("a", 0);
    expect(mgr.isRunning("a")).toBe(false);

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
});
