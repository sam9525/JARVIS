/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-empty-function */
import { vi, describe, it, expect, beforeEach } from "vitest";

let states: any[] = [];
let idx = 0;

vi.mock("react", async () => {
  const actual = (await vi.importActual("react")) as any;
  return {
    ...actual,
    useState: (init: any) => {
      const i = idx++;
      if (!(i in states))
        states[i] = typeof init === "function" ? init() : init;
      return [
        states[i],
        (v: any) => {
          states[i] = typeof v === "function" ? v(states[i]) : v;
        },
      ];
    },
    useEffect: () => {},
    useRef: (init: any) => ({ current: init }),
  };
});

vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    cols = 80;
    rows = 24;
    loadAddon() {}
    open() {}
    focus() {}
    onData() {}
    writeln() {}
    write() {}
  },
}));
vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class {
    fit() {}
  },
}));

import TerminalPanel from "../src/renderer/TerminalPanel";
import type { Workspace } from "../src/shared/types";

const workspace: Workspace = {
  id: "w1",
  name: "vault",
  rootPath: "D:\\vault",
  kind: "vault",
};

const ptyLaunch = vi.fn(async () => ({ ok: true, hooksOk: true }));

beforeEach(() => {
  states = [];
  idx = 0;
  ptyLaunch.mockClear();
  (global as any).document = {
    createElement: () => ({ style: {}, replaceChildren() {} }),
  };
  (global as any).window = {
    jarvis: {
      ptyLaunch,
      ptyInput: () => {},
      ptyResize: () => {},
      onPtyData: () => {},
      onPtyExit: () => {},
    },
    addEventListener: () => {},
    removeEventListener: () => {},
    innerWidth: 1600,
  };
});

// re-runs the component against the persisted state array
function render(): any {
  idx = 0;
  return TerminalPanel({ workspace });
}

function buttons(node: any, out: any[] = []): any[] {
  if (!node || typeof node !== "object") return out;
  if (Array.isArray(node)) {
    for (const c of node) buttons(c, out);
    return out;
  }
  if (node.type === "button") out.push(node.props);
  buttons(node.props?.children, out);
  return out;
}

function text(node: any): string {
  if (node === null || node === undefined || typeof node === "boolean")
    return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(text).join("");
  return text(node.props?.children);
}

function findButton(tree: any, match: RegExp): any {
  const b = buttons(tree).find((p) => match.test(text(p.children)));
  if (!b) throw new Error(`no button matching ${match}`);
  return b;
}

describe("TerminalPanel dangerous launch", () => {
  it("spawns nothing on the first click and names the consequence", () => {
    // the panel starts collapsed — expand it the way a user does
    findButton(render(), /">_"|>_/).onClick();

    const armButton = findButton(render(), /without permission prompts/);
    armButton.onClick();

    // the whole point: one click must not spawn a permission-free session
    expect(ptyLaunch).not.toHaveBeenCalled();

    const confirmButton = findButton(render(), /Click again/);
    expect(text(confirmButton.children)).toContain("unprompted");

    confirmButton.onClick();
    expect(ptyLaunch).toHaveBeenCalledTimes(1);
    // 4th arg is `dangerous`
    expect(ptyLaunch.mock.calls[0][3]).toBe(true);
  });

  it("leaves the safe launch a single click", () => {
    findButton(render(), /">_"|>_/).onClick();
    findButton(render(), /Launch Claude/).onClick();
    expect(ptyLaunch).toHaveBeenCalledTimes(1);
    expect(ptyLaunch.mock.calls[0][3]).toBe(false);
  });
});
