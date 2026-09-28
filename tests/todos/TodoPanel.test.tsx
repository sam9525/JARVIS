// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/no-explicit-any */
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import TodoPanel from "../../src/renderer/todos/TodoPanel";
import type { TodoList } from "../../src/shared/types";
import { parseTodos } from "../../src/main/todos";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  act(() => {
    root = createRoot(container);
  });
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const FILE =
  "# Todo\n" +
  "- [ ] Fix the ring snap @JARVIS 2026-09-27\n" +
  "- [ ] Call the bank 2026-09-26\n" +
  "- [ ] Ship v0.5.1 @JARVIS 2026-09-25\n" +
  "- [x] Ship v0.5.0 @JARVIS 2026-09-20\n";
const list: TodoList = parseTodos(FILE);

const ok = () => vi.fn().mockResolvedValue({ ok: true });
const render = (onOp = ok(), todos: TodoList = list) => {
  act(() =>
    root.render(
      <TodoPanel list={todos} projects={["JARVIS", "AeroGraph"]} onOp={onOp} />,
    ),
  );
  return onOp;
};
const $ = (sel: string) => container.querySelector(sel) as HTMLElement;
const $$ = (sel: string) =>
  [...container.querySelectorAll(sel)] as HTMLElement[];
const rows = () => $$('[data-testid="todo-row"]');
const setValue = (el: HTMLTextAreaElement, value: string) => {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    "value",
  )!.set!;
  act(() => {
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
};
const key = (el: HTMLElement, k: string, isComposing = false) =>
  act(async () => {
    el.dispatchEvent(
      new KeyboardEvent("keydown", { key: k, bubbles: true, isComposing }),
    );
  });

describe("TodoPanel growth", () => {
  // jsdom lays nothing out, so the box sizes are stubbed on the prototype
  const stub = (client: number, scroll: number) => {
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(
      client,
    );
    vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(
      scroll,
    );
  };
  afterEach(() => vi.restoreAllMocks());
  const mount = (onOverflow: (px: number) => void) =>
    act(() =>
      root.render(
        <TodoPanel
          list={list}
          projects={[]}
          onOp={ok()}
          onOverflow={onOverflow}
        />,
      ),
    );

  it("asks for the missing height when the list overflows", () => {
    stub(200, 260);
    const onOverflow = vi.fn();
    mount(onOverflow);
    expect(onOverflow).toHaveBeenCalledWith(60);
  });

  it("asks for nothing when the list fits, or the box is not laid out", () => {
    const fits = vi.fn();
    stub(200, 200);
    mount(fits);
    const hidden = vi.fn();
    stub(0, 260);
    mount(hidden);
    expect(fits).not.toHaveBeenCalled();
    expect(hidden).not.toHaveBeenCalled();
  });
});

describe("TodoPanel", () => {
  it("shows open tasks grouped by project, with counts and ages", () => {
    render();
    expect($('[data-testid="todo-open"]').textContent).toContain("TO DO (3)");
    const groups = $$('[data-testid="todo-open"] [data-testid="todo-group"]');
    expect(
      groups.map(
        (g) => g.querySelector('[data-testid="todo-group-name"]')?.textContent,
      ),
    ).toEqual(["JARVIS", "Personal"]);
    expect(groups[0].textContent).toContain("2");
    expect(rows()[0].textContent).toContain("Fix the ring snap");
    // the age reads relative; the exact created date is its tooltip
    expect(rows()[0].querySelector('[title="2026-09-27"]')).not.toBeNull();
  });

  it("colours a workspace header and opens that workspace from it", () => {
    const onOpenProject = vi.fn();
    act(() =>
      root.render(
        <TodoPanel
          list={list}
          projects={["JARVIS", "AeroGraph"]}
          colors={{ JARVIS: "#8b7cf6" }}
          onOp={ok()}
          onOpenProject={onOpenProject}
        />,
      ),
    );
    const [jarvis, personal] = $$(
      '[data-testid="todo-open"] [data-testid="todo-group"]',
    );
    expect(jarvis.innerHTML).toContain("#8b7cf6");
    act(() =>
      (jarvis.querySelector('[title="Open JARVIS"]') as HTMLElement).click(),
    );
    expect(onOpenProject).toHaveBeenCalledWith("JARVIS");
    // Personal is no workspace, so it has nothing to open
    expect(personal.querySelector("[title^='Open']")).toBeNull();
  });

  it("folds Done by default and unfolds it on click", () => {
    render();
    const done = $('[data-testid="todo-done"]');
    expect(done.textContent).toContain("DONE (1)");
    expect(done.querySelectorAll('[data-testid="todo-row"]')).toHaveLength(0);
    act(() => (done.querySelector("button") as HTMLElement).click());
    expect(done.querySelectorAll('[data-testid="todo-row"]')).toHaveLength(1);
  });

  it("ticks a task with its line and raw text", () => {
    const onOp = render();
    act(() => (rows()[0].querySelector("input") as HTMLElement).click());
    expect(onOp).toHaveBeenCalledWith({
      kind: "toggle",
      line: 1,
      raw: "- [ ] Fix the ring snap @JARVIS 2026-09-27",
    });
  });

  it("deletes a task", () => {
    const onOp = render();
    act(() => $$('[data-testid="todo-row"] [title="Delete"]')[1].click());
    expect(onOp).toHaveBeenCalledWith({
      kind: "delete",
      line: 3,
      raw: "- [ ] Ship v0.5.1 @JARVIS 2026-09-25",
    });
  });

  const composer = () => $('[data-testid="todo-composer"]');
  const textBox = () =>
    composer().querySelector("textarea") as HTMLTextAreaElement;
  const chip = (label: string) =>
    [...composer().querySelectorAll("button[aria-pressed]")].find(
      (b) => b.textContent === label,
    ) as HTMLElement;
  const pressed = () =>
    composer().querySelector('button[aria-pressed="true"]')?.textContent;
  const openAdd = () =>
    act(() => ($('[title="New task (N)"]') as HTMLElement).click());

  it("edits text and project in the composer; Enter saves, Esc cancels", async () => {
    const onOp = render();
    act(() => $$('[data-testid="todo-row"] [title="Edit"]')[0].click());
    expect(composer().textContent).toContain("EDIT TASK");
    expect(textBox().value).toBe("Fix the ring snap");
    expect(pressed()).toBe("JARVIS");
    setValue(textBox(), "Fix the snap");
    act(() => chip("AeroGraph").click());
    await key(textBox(), "Enter");
    expect(onOp).toHaveBeenCalledWith({
      kind: "edit",
      line: 1,
      raw: "- [ ] Fix the ring snap @JARVIS 2026-09-27",
      text: "Fix the snap",
      project: "AeroGraph",
    });
    expect(composer()).toBeNull();

    act(() => $$('[data-testid="todo-row"] [title="Edit"]')[0].click());
    await key(textBox(), "Escape");
    expect(composer()).toBeNull();
    expect(onOp).toHaveBeenCalledTimes(1);
  });

  it("opens the composer from the + button and from N, not from a text field", () => {
    render();
    expect(composer()).toBeNull();
    openAdd();
    expect(composer().textContent).toContain("NEW TASK");
    expect($('[title="New task (N)"]')).toBeNull();
    act(() =>
      (composer().querySelector('[title="Close"]') as HTMLElement).click(),
    );
    expect(composer()).toBeNull();

    const checkbox = rows()[0].querySelector("input") as HTMLElement;
    act(() => {
      checkbox.dispatchEvent(
        new KeyboardEvent("keydown", { key: "n", bubbles: true }),
      );
    });
    expect(composer()).not.toBeNull();
  });

  it("adds tasks with the chosen project and stays open for the next", async () => {
    const onOp = render();
    openAdd();
    expect(
      [...composer().querySelectorAll("button[aria-pressed]")].map(
        (b) => b.textContent,
      ),
    ).toEqual(["Personal", "JARVIS", "AeroGraph"]);
    expect(pressed()).toBe("Personal");
    setValue(textBox(), "Buy milk");
    await key(textBox(), "Enter");
    expect(onOp).toHaveBeenLastCalledWith({
      kind: "add",
      text: "Buy milk",
      project: null,
    });
    expect(textBox().value).toBe("");
    setValue(textBox(), "Ship");
    act(() => chip("JARVIS").click());
    await act(async () =>
      [...composer().querySelectorAll("button")]
        .find((b) => b.textContent === "Add")
        ?.click(),
    );
    expect(onOp).toHaveBeenLastCalledWith({
      kind: "add",
      text: "Ship",
      project: "JARVIS",
    });
    expect(pressed()).toBe("JARVIS");
  });

  it("turns a pasted newline into a space, since a task is one line", () => {
    render();
    openAdd();
    setValue(textBox(), "Buy\n  milk");
    expect(textBox().value).toBe("Buy milk");
  });

  it("writes nothing for an empty add", async () => {
    const onOp = render();
    openAdd();
    await key(textBox(), "Enter");
    expect(onOp).not.toHaveBeenCalled();
  });

  it("keeps the typed task and shows why when an add is refused", async () => {
    const onOp = vi.fn().mockResolvedValue({ ok: false, error: "EBUSY" });
    render(onOp);
    openAdd();
    setValue(textBox(), "Buy milk");
    await key(textBox(), "Enter");
    expect(textBox().value).toBe("Buy milk");
    expect($('[data-testid="todo-error"]').textContent).toBe(
      "Not saved: EBUSY",
    );
    onOp.mockResolvedValue({ ok: true });
    await key(textBox(), "Enter");
    expect($('[data-testid="todo-error"]')).toBeNull();
  });

  it("keeps the composer open when an edit is refused", async () => {
    render(vi.fn().mockResolvedValue({ ok: false, error: "stale" }));
    act(() => $$('[data-testid="todo-row"] [title="Edit"]')[0].click());
    await key(textBox(), "Enter");
    expect(composer()).not.toBeNull();
    expect($('[data-testid="todo-error"]').textContent).toContain("stale");
  });

  it("ignores Enter while an IME is composing", async () => {
    const onOp = render();
    act(() => $$('[data-testid="todo-row"] [title="Edit"]')[0].click());
    await key(textBox(), "Enter", true);
    expect(onOp).not.toHaveBeenCalled();
  });

  it("closes the composer when a row above the edited one is deleted", () => {
    render();
    // edit "Call the bank" (line 2), then the file loses line 1
    act(() => $$('[data-testid="todo-row"] [title="Edit"]')[2].click());
    expect(textBox().value).toBe("Call the bank");
    const shifted = parseTodos(
      "# Todo\n" +
        "- [ ] Call the bank 2026-09-26\n" +
        "- [ ] Ship v0.5.1 @JARVIS 2026-09-25\n",
    );
    render(ok(), shifted);
    // "Ship v0.5.1" now sits on line 2; the composer must not edit it instead
    expect(composer()).toBeNull();
  });

  const drag = (from: HTMLElement, to: HTMLElement) =>
    act(() => {
      from.dispatchEvent(new Event("dragstart", { bubbles: true }));
      to.dispatchEvent(
        new Event("dragover", { bubbles: true, cancelable: true }),
      );
      to.dispatchEvent(new Event("drop", { bubbles: true, cancelable: true }));
    });

  it("drags a row onto another row of the same project", () => {
    const onOp = render();
    const [first, second] = rows(); // both JARVIS, lines 1 and 3
    drag(second, first);
    expect(onOp).toHaveBeenCalledWith({
      kind: "move",
      line: 3,
      raw: "- [ ] Ship v0.5.1 @JARVIS 2026-09-25",
      toLine: 1,
      toRaw: "- [ ] Fix the ring snap @JARVIS 2026-09-27",
    });
  });

  it("refuses a drop into another project", () => {
    const onOp = render();
    const personal = rows().find((r) =>
      r.textContent?.includes("Call the bank"),
    )!;
    drag(rows()[0], personal);
    expect(onOp).not.toHaveBeenCalled();
  });

  it("clears dragged state on dragend outside a drop target", () => {
    const onOp = render();
    const [first, second] = rows();
    act(() => {
      second.dispatchEvent(new Event("dragstart", { bubbles: true }));
      second.dispatchEvent(new Event("dragend", { bubbles: true }));
      first.dispatchEvent(
        new Event("drop", { bubbles: true, cancelable: true }),
      );
    });
    expect(onOp).not.toHaveBeenCalled();
  });
});
