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
    useLayoutEffect: () => {},
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

import TerminalPanel, {
  detailBox,
} from "../../src/renderer/terminal/TerminalPanel";
import type { Workspace } from "../../src/shared/types";

const walk = (n: any): any[] =>
  !n || typeof n !== "object"
    ? []
    : Array.isArray(n)
      ? n.flatMap(walk)
      : [n, ...walk(n.props?.children)];

const workspace: Workspace = {
  id: "w1",
  name: "vault",
  rootPath: "D:\\vault",
  kind: "vault",
  sourceId: "vault",
};

const WS: Workspace = {
  id: "d:/x",
  name: "Xray",
  rootPath: "D:/x",
  kind: "code" as const,
  sourceId: "gitnexus",
};

const ptyLaunch = vi.fn(async (..._a: unknown[]) => ({
  ok: true,
  hooksOk: true,
}));

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
      ptyInput: () => Promise.resolve(true),
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
    findButton(render(), /Launch Claude/).onClick();
    expect(ptyLaunch).toHaveBeenCalledTimes(1);
    expect(ptyLaunch.mock.calls[0][3]).toBe(false);
  });
});

// main spawns the main agent's pty at boot, so the panel never saw that launch
describe("TerminalPanel attaching to a session it did not launch", () => {
  const overlay = (tree: any) =>
    find(tree, (n) => String(n.props?.className ?? "").includes("bg-panel/80"));

  it("shows the launch overlay when no pty is attached", () => {
    expect(overlay(render())).toBeDefined();
  });

  it("hides it while the workspace reports a live pty", () => {
    expect(overlay(render({ live: true }))).toBeUndefined();
  });

  it("lets a later launch it did not make replace a remembered exit", () => {
    render();
    // localStatuses is the second useState; the pty-exit listener writes it
    states[1] = { [workspace.id]: { kind: "exited", code: 0 } };
    expect(overlay(render())).toBeDefined();
    expect(overlay(render({ live: true }))).toBeUndefined();
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
    expect(
      find(render(), (n) => n.props?.["data-testid"] === "terminal-inbox"),
    ).toBeUndefined();
  });

  it("opens a detail panel from a row, and closes it on a second click", () => {
    expect(detail(open())).toBeUndefined();

    const row = find(open(), (n) => typeof n.props?.onSelect === "function");
    row.props.onSelect(workspace);
    expect(text(detail(open()).props.children)).toContain("vault");
    // Panel's body is overflow-hidden, so an absolute box placed beside the
    // panel is clipped away and the view silently never appears
    expect(detail(open()).props.className).toContain("fixed");

    row.props.onSelect(workspace);
    expect(detail(open())).toBeUndefined();
  });

  // the message is Claude's markdown — rendered, not shown as **literal**
  it("renders the message through the preview pipeline", () => {
    find(open(), (n) => typeof n.props?.onSelect === "function").props.onSelect(
      workspace,
    );
    const body = find(detail(open()), (n) =>
      String(n.props?.className ?? "").includes("preview-body"),
    );
    expect(body.props.dangerouslySetInnerHTML).toBeDefined();
  });
});

describe("detailBox", () => {
  const panel = (left: number, top: number, w = 400) => ({
    left,
    right: left + w,
    top,
  });

  it("sits to the panel's left, level with its top edge", () => {
    expect(detailBox(panel(900, 60), 340, 1000)).toEqual({
      left: 540,
      top: 60,
      maxHeight: 920,
    });
  });

  it("flips to the right when the left edge has no room", () => {
    expect(detailBox(panel(120, 60), 340, 1000).left).toBe(540);
  });

  // a collapsed terminal is a short strip that can sit low on the screen; the
  // message still needs a readable box, so the top lifts rather than squeezing
  it("lifts the box up when the panel sits too low to fit one", () => {
    expect(detailBox(panel(900, 900), 340, 1000)).toMatchObject({
      top: 660,
      maxHeight: 320,
    });
  });
});

describe("TerminalPanel panel shell", () => {
  it("no longer owns a width splitter or a collapse tab", () => {
    const nodes = walk((TerminalPanel as any)({ workspace: WS }));
    const classes = nodes
      .map((n: any) => n.props?.className)
      .filter((c: any) => typeof c === "string");
    expect(classes.some((c: string) => c.includes("cursor-col-resize"))).toBe(
      false,
    );
    expect(nodes.some((n: any) => n.props?.title === "Open terminal")).toBe(
      false,
    );
  });

  it("puts the inbox above the terminal body", () => {
    const nodes = walk(
      (TerminalPanel as any)({
        workspace: WS,
        inbox: { workspaces: [WS], statuses: [] },
      }),
    );
    const inbox = nodes.findIndex(
      (n: any) => n.props?.["data-testid"] === "terminal-inbox",
    );
    const body = nodes.findIndex(
      (n: any) => n.props?.["data-testid"] === "terminal-body",
    );
    expect(inbox).toBeGreaterThan(-1);
    expect(body).toBeGreaterThan(inbox);
  });
});
