// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/no-explicit-any */
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import TodoPanel from "../../src/renderer/todos/TodoPanel";
import type { Todo, TodoList } from "../../src/shared/types";
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
const onNew = vi.fn();
const onEdit = vi.fn();
const onView = vi.fn();
beforeEach(() => {
  onNew.mockClear();
  onEdit.mockClear();
  onView.mockClear();
});
const render = (
  onOp = ok(),
  todos: TodoList = list,
  editing: Todo | null = null,
) => {
  act(() =>
    root.render(
      <TodoPanel
        list={todos}
        projects={["JARVIS", "AeroGraph"]}
        editing={editing}
        onOp={onOp}
        onNew={onNew}
        onEdit={onEdit}
        onView={onView}
      />,
    ),
  );
  return onOp;
};
const $ = (sel: string) => container.querySelector(sel) as HTMLElement;
const $$ = (sel: string) =>
  [...container.querySelectorAll(sel)] as HTMLElement[];
const rows = () => $$('[data-testid="todo-row"]');
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
          onNew={onNew}
          onEdit={onEdit}
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

  it("asks nothing when only the owner's callback changes, so a resize holds", () => {
    stub(200, 260);
    mount(vi.fn());
    const afterResize = vi.fn();
    mount(afterResize);
    expect(afterResize).not.toHaveBeenCalled();
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
          onNew={onNew}
          onEdit={onEdit}
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

  it("asks for the composer from the + button and from N", () => {
    render();
    act(() => ($('[title="New task (N)"]') as HTMLElement).click());
    expect(onNew).toHaveBeenCalledTimes(1);
    const checkbox = rows()[0].querySelector("input") as HTMLElement;
    // a ticked checkbox keeps focus, and N must still work from there
    act(() => {
      checkbox.dispatchEvent(
        new KeyboardEvent("keydown", { key: "n", bubbles: true }),
      );
    });
    expect(onNew).toHaveBeenCalledTimes(2);
  });

  it("asks for an edit with the task and its project's chip", () => {
    render();
    act(() => $$('[data-testid="todo-row"] [title="Edit"]')[0].click());
    expect(onEdit).toHaveBeenCalledWith(list.todos[0], "JARVIS");
    act(() => $$('[data-testid="todo-row"] [title="Edit"]')[2].click()); // grouped: row 3 is Personal
    expect(onEdit).toHaveBeenLastCalledWith(list.todos[1], "");
  });

  it("asks for the view on a row double-click, never the composer", () => {
    render();
    const dbl = (el: Element) =>
      act(() => {
        el.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      });
    dbl(rows()[0].querySelector("span") as Element);
    expect(onView).toHaveBeenCalledWith(list.todos[0], "JARVIS");
    expect(onEdit).not.toHaveBeenCalled();
    // a double-click on the checkbox is two ticks, not a view
    dbl(rows()[1].querySelector("input") as Element);
    expect(onView).toHaveBeenCalledTimes(1);
  });

  it("lights the row the composer is editing", () => {
    render(ok(), list, list.todos[2]);
    const lit = rows().filter((r) => r.className.includes("bg-accent/10"));
    expect(lit.map((r) => r.textContent)).toEqual([
      expect.stringContaining("Ship v0.5.1"),
    ]);
  });

  it("shows why a tick was refused", async () => {
    render(vi.fn().mockResolvedValue({ ok: false, error: "stale" }));
    await act(async () =>
      (rows()[0].querySelector("input") as HTMLElement).click(),
    );
    expect($('[data-testid="todo-error"]').textContent).toBe(
      "Not saved: stale",
    );
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
