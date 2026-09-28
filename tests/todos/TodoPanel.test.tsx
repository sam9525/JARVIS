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
const setValue = (el: HTMLInputElement | HTMLSelectElement, value: string) => {
  const proto =
    el instanceof HTMLSelectElement
      ? HTMLSelectElement.prototype
      : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")!.set!;
  act(() => {
    setter.call(el, value);
    el.dispatchEvent(
      new Event(el instanceof HTMLSelectElement ? "change" : "input", {
        bubbles: true,
      }),
    );
  });
};
const key = (el: HTMLElement, k: string, isComposing = false) =>
  act(async () => {
    el.dispatchEvent(
      new KeyboardEvent("keydown", { key: k, bubbles: true, isComposing }),
    );
  });
const submit = (form: HTMLElement) =>
  act(async () => {
    form.dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
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
  it("shows open tasks grouped by project, with counts and dates", () => {
    render();
    expect($('[data-testid="todo-open"]').textContent).toContain("TO DO (3)");
    const groups = $$('[data-testid="todo-open"] [data-testid="todo-group"]');
    expect(groups.map((g) => g.firstElementChild?.textContent)).toEqual([
      "JARVIS",
      "Personal",
    ]);
    expect(rows()[0].textContent).toContain("Fix the ring snap");
    expect(rows()[0].textContent).toContain("2026-09-27");
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

  it("edits text and project in place; Enter saves, Esc cancels", async () => {
    const onOp = render();
    act(() => $$('[data-testid="todo-row"] [title="Edit"]')[0].click());
    const editor = $('[data-testid="todo-editor"]');
    const input = editor.querySelector("input") as HTMLInputElement;
    const select = editor.querySelector("select") as HTMLSelectElement;
    expect(input.value).toBe("Fix the ring snap");
    expect(select.value).toBe("JARVIS");
    setValue(input, "Fix the snap");
    setValue(select, "AeroGraph");
    await key(input, "Enter");
    expect(onOp).toHaveBeenCalledWith({
      kind: "edit",
      line: 1,
      raw: "- [ ] Fix the ring snap @JARVIS 2026-09-27",
      text: "Fix the snap",
      project: "AeroGraph",
    });
    expect($('[data-testid="todo-editor"]')).toBeNull();

    act(() => $$('[data-testid="todo-row"] [title="Edit"]')[0].click());
    await key($('[data-testid="todo-editor"] input'), "Escape");
    expect($('[data-testid="todo-editor"]')).toBeNull();
    expect(onOp).toHaveBeenCalledTimes(1);
  });

  it("adds a task with the chosen project, or none", async () => {
    const onOp = render();
    const form = $('[data-testid="todo-add"]');
    const input = form.querySelector("input") as HTMLInputElement;
    const select = form.querySelector("select") as HTMLSelectElement;
    expect([...select.options].map((o) => o.textContent)).toEqual([
      "none",
      "JARVIS",
      "AeroGraph",
    ]);
    setValue(input, "Buy milk");
    await submit(form);
    expect(onOp).toHaveBeenLastCalledWith({
      kind: "add",
      text: "Buy milk",
      project: null,
    });
    expect(input.value).toBe("");
    setValue(input, "Ship");
    setValue(select, "JARVIS");
    await submit(form);
    expect(onOp).toHaveBeenLastCalledWith({
      kind: "add",
      text: "Ship",
      project: "JARVIS",
    });
  });

  it("writes nothing for an empty add", async () => {
    const onOp = render();
    await submit($('[data-testid="todo-add"]'));
    expect(onOp).not.toHaveBeenCalled();
  });

  it("keeps the typed task and shows why when an add is refused", async () => {
    const onOp = vi.fn().mockResolvedValue({ ok: false, error: "EBUSY" });
    render(onOp);
    const form = $('[data-testid="todo-add"]');
    const input = form.querySelector("input") as HTMLInputElement;
    setValue(input, "Buy milk");
    await submit(form);
    expect(input.value).toBe("Buy milk");
    expect($('[data-testid="todo-error"]').textContent).toBe(
      "Not saved: EBUSY",
    );
    onOp.mockResolvedValue({ ok: true });
    await submit(form);
    expect($('[data-testid="todo-error"]')).toBeNull();
  });

  it("keeps the editor open when an edit is refused", async () => {
    render(vi.fn().mockResolvedValue({ ok: false, error: "stale" }));
    act(() => $$('[data-testid="todo-row"] [title="Edit"]')[0].click());
    await key($('[data-testid="todo-editor"] input'), "Enter");
    expect($('[data-testid="todo-editor"]')).not.toBeNull();
    expect($('[data-testid="todo-error"]').textContent).toContain("stale");
  });

  it("ignores Enter while an IME is composing", async () => {
    const onOp = render();
    act(() => $$('[data-testid="todo-row"] [title="Edit"]')[0].click());
    await key($('[data-testid="todo-editor"] input'), "Enter", true);
    expect(onOp).not.toHaveBeenCalled();
  });

  it("closes the editor when a row above it is deleted, not moves it", () => {
    render();
    // edit "Call the bank" (line 2), then the file loses line 1
    act(() => $$('[data-testid="todo-row"] [title="Edit"]')[2].click());
    expect(
      ($('[data-testid="todo-editor"] input') as HTMLInputElement).value,
    ).toBe("Call the bank");
    const shifted = parseTodos(
      "# Todo\n" +
        "- [ ] Call the bank 2026-09-26\n" +
        "- [ ] Ship v0.5.1 @JARVIS 2026-09-25\n",
    );
    render(ok(), shifted);
    // "Ship v0.5.1" now sits on line 2; the editor must not open over it
    expect($('[data-testid="todo-editor"]')).toBeNull();
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
