// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/no-explicit-any */
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import TodoView from "../../src/renderer/todos/TodoView";
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

const todo = parseTodos("- [ ] Fix the ring snap @JARVIS 2026-09-27\n")
  .todos[0];
const button = (label: string) =>
  [...container.querySelectorAll("button")].find(
    (b) => b.textContent === label,
  ) as HTMLButtonElement;

const render = (onOp = vi.fn().mockResolvedValue({ ok: true })) => {
  const onEdit = vi.fn();
  const onClose = vi.fn();
  act(() =>
    root.render(
      <TodoView
        todo={todo}
        project="JARVIS"
        colors={{}}
        onOp={onOp}
        onEdit={onEdit}
        onClose={onClose}
      />,
    ),
  );
  return { onOp, onEdit, onClose };
};

describe("TodoView", () => {
  it("shows the task, its project and its created date", () => {
    render();
    const text = container.textContent ?? "";
    expect(text).toContain("Fix the ring snap");
    expect(text).toContain("JARVIS");
    expect(text).toContain("2026-09-27");
  });

  it("asks for the composer from Edit", () => {
    const { onEdit, onOp } = render();
    act(() => button("Edit").click());
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onOp).not.toHaveBeenCalled();
  });

  it("deletes the task by line and raw, then closes", async () => {
    const { onOp, onClose } = render();
    await act(async () => button("Delete").click());
    expect(onOp).toHaveBeenCalledWith({
      kind: "delete",
      line: todo.line,
      raw: todo.raw,
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("stays open and says why when the delete is refused", async () => {
    const { onClose } = render(
      vi.fn().mockResolvedValue({ ok: false, error: "stale" }),
    );
    await act(async () => button("Delete").click());
    expect(onClose).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "stale",
    );
  });
});
