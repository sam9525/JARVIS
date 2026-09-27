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

const render = (onOp = vi.fn()) => {
  act(() =>
    root.render(
      <TodoPanel list={list} projects={["JARVIS", "AeroGraph"]} onOp={onOp} />,
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
const key = (el: HTMLElement, k: string) =>
  act(() => {
    el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true }));
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

  it("edits text and project in place; Enter saves, Esc cancels", () => {
    const onOp = render();
    act(() => $$('[data-testid="todo-row"] [title="Edit"]')[0].click());
    const editor = $('[data-testid="todo-editor"]');
    const input = editor.querySelector("input") as HTMLInputElement;
    const select = editor.querySelector("select") as HTMLSelectElement;
    expect(input.value).toBe("Fix the ring snap");
    expect(select.value).toBe("JARVIS");
    setValue(input, "Fix the snap");
    setValue(select, "AeroGraph");
    key(input, "Enter");
    expect(onOp).toHaveBeenCalledWith({
      kind: "edit",
      line: 1,
      raw: "- [ ] Fix the ring snap @JARVIS 2026-09-27",
      text: "Fix the snap",
      project: "AeroGraph",
    });
    expect($('[data-testid="todo-editor"]')).toBeNull();

    act(() => $$('[data-testid="todo-row"] [title="Edit"]')[0].click());
    key($('[data-testid="todo-editor"] input'), "Escape");
    expect($('[data-testid="todo-editor"]')).toBeNull();
    expect(onOp).toHaveBeenCalledTimes(1);
  });

  it("adds a task with the chosen project, or none", () => {
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
    act(() => {
      form.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
    });
    expect(onOp).toHaveBeenLastCalledWith({
      kind: "add",
      text: "Buy milk",
      project: null,
    });
    expect(input.value).toBe("");
    setValue(input, "Ship");
    setValue(select, "JARVIS");
    act(() => {
      form.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
    });
    expect(onOp).toHaveBeenLastCalledWith({
      kind: "add",
      text: "Ship",
      project: "JARVIS",
    });
  });

  it("writes nothing for an empty add", () => {
    const onOp = render();
    act(() => {
      $('[data-testid="todo-add"]').dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
    });
    expect(onOp).not.toHaveBeenCalled();
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
