/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-empty-function */
import { describe, expect, it, vi, beforeAll, beforeEach } from "vitest";

const made: any[] = [];
vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    cols = 80;
    rows = 24;
    write = vi.fn();
    dispose = vi.fn();
    constructor() {
      made.push(this);
    }
    loadAddon() {}
    open() {}
    onData() {}
  },
}));
vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class {
    fit() {}
  },
}));

import {
  ensureSubscribed,
  entryFor,
  releaseDetached,
} from "../../src/renderer/terminal/terminal-registry";

let onData: (key: string, data: string) => void = () => {};
let onExit: (key: string, code: number) => void = () => {};
// what the next terminal's element reports; isConnected is how the registry
// tells a terminal on screen from a parked one
let connected = false;

beforeAll(() => {
  (global as any).document = {
    createElement: () => ({ style: {}, isConnected: connected }),
  };
  (global as any).window = {
    jarvis: {
      ptyInput: () => Promise.resolve(true),
      onPtyData: (cb: any) => (onData = cb),
      onPtyExit: (cb: any) => (onExit = cb),
    },
  };
  ensureSubscribed();
});

beforeEach(() => {
  made.length = 0;
  connected = false;
});

describe("terminal registry", () => {
  it("makes a session's terminal on its first output", () => {
    onData("a#1", "hello");
    expect(made).toHaveLength(1);
    expect(made[0].write).toHaveBeenCalledWith("hello");
    // the same terminal is the one a later attach gets
    expect(entryFor("a#1").term).toBe(made[0]);
  });

  it("frees a numbered session's terminal when it exits", () => {
    onData("b#1", "old");
    const old = made[0];
    onExit("b#1", 0);
    expect(old.dispose).toHaveBeenCalled();
    // a reused key starts on an empty screen
    expect(entryFor("b#1").term).not.toBe(old);
  });

  it("keeps a main session's terminal through its exit", () => {
    onData("c", "scrollback");
    onExit("c", 1);
    expect(made[0].dispose).not.toHaveBeenCalled();
    expect(entryFor("c").term).toBe(made[0]);
  });

  it("frees an attached terminal only once it is detached", () => {
    connected = true;
    onData("d#1", "x");
    onExit("d#1", 0);
    expect(made[0].dispose).not.toHaveBeenCalled();
    releaseDetached("d#1");
    expect(made[0].dispose).toHaveBeenCalled();
    connected = false;
    expect(entryFor("d#1").term).not.toBe(made[0]);
  });
});
