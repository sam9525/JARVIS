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

import TerminalPanel from "../../src/renderer/terminal/TerminalPanel";
import type { Workspace } from "../../src/shared/types";

const workspace: Workspace = {
  id: "w1",
  name: "vault",
  rootPath: "D:\\vault",
  kind: "vault",
  sourceId: "vault",
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
      staleReindexCommand: async () => null,
    },
    addEventListener: () => {},
    removeEventListener: () => {},
    innerWidth: 1600,
  };
});

// re-runs the component against the persisted state array
function render(props: any = {}): any {
  idx = 0;
  return TerminalPanel({ workspace, ...props });
}

function find(node: any, pred: (n: any) => boolean): any {
  if (!node || typeof node !== "object") return undefined;
  if (Array.isArray(node)) {
    for (const c of node) {
      const hit = find(c, pred);
      if (hit) return hit;
    }
    return undefined;
  }
  if (pred(node)) return node;
  return find(node.props?.children, pred);
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

describe("TerminalPanel inbox", () => {
  const inbox = {
    workspaces: [workspace],
    statuses: [
      {
        workspaceId: "w1",
        kind: "idle" as const,
        call: "",
        message: "all done",
        since: 0,
        reads: 2,
        edits: 1,
      },
    ],
  };
  const open = () => render({ inbox });
  const detail = (tree: any) =>
    find(tree, (n) => n.props?.["data-testid"] === "inbox-detail");

  it("is home-only — a workspace terminal shows no inbox", () => {
    findButton(render(), /">_"|>_/).onClick();
    expect(
      find(render(), (n) => n.props?.["data-testid"] === "terminal-inbox"),
    ).toBeUndefined();
  });

  it("opens a detail panel from a row, and closes it on a second click", () => {
    findButton(open(), /">_"|>_/).onClick();
    expect(detail(open())).toBeUndefined();

    const row = find(open(), (n) => typeof n.props?.onSelect === "function");
    row.props.onSelect(workspace);
    expect(text(detail(open()).props.children)).toContain("vault");

    row.props.onSelect(workspace);
    expect(detail(open())).toBeUndefined();
  });

  // the message is Claude's markdown — rendered, not shown as **literal**
  it("renders the message through the preview pipeline", () => {
    findButton(open(), /">_"|>_/).onClick();
    find(open(), (n) => typeof n.props?.onSelect === "function").props.onSelect(
      workspace,
    );
    const body = find(detail(open()), (n) =>
      String(n.props?.className ?? "").includes("preview-body"),
    );
    expect(body.props.dangerouslySetInnerHTML).toBeDefined();
  });
});
