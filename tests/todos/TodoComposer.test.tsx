// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/no-explicit-any */
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import TodoComposer, {
  type ComposeRequest,
} from "../../src/renderer/todos/TodoComposer";
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

const [task] = parseTodos(
  "# Todo\n- [ ] Fix the ring snap @JARVIS 2026-09-27\n",
).todos;
const EDIT: ComposeRequest = { mode: "edit", todo: task, project: "JARVIS" };

const ok = () => vi.fn().mockResolvedValue({ ok: true });
const render = (request: ComposeRequest = { mode: "add" }, onOp = ok()) => {
  const onClose = vi.fn();
  act(() =>
    root.render(
      <TodoComposer
        request={request}
        projects={["JARVIS", "AeroGraph"]}
        colors={{ JARVIS: "#8b7cf6" }}
        onOp={onOp}
        onClose={onClose}
      />,
    ),
  );
  return { onOp, onClose };
};
const $ = (sel: string) => container.querySelector(sel) as HTMLElement;
const textBox = () => $("textarea") as HTMLTextAreaElement;
const chips = () =>
  [...container.querySelectorAll("button[aria-pressed]")] as HTMLElement[];
const chip = (label: string) => chips().find((b) => b.textContent === label)!;
const pressed = () => $('button[aria-pressed="true"]')?.textContent;
const button = (label: string) =>
  [...container.querySelectorAll("button")].find(
    (b) => b.textContent === label,
  ) as HTMLElement;
const type = (value: string) => {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    "value",
  )!.set!;
  act(() => {
    setter.call(textBox(), value);
    textBox().dispatchEvent(new Event("input", { bubbles: true }));
  });
};
const key = (k: string, isComposing = false) =>
  act(async () => {
    textBox().dispatchEvent(
      new KeyboardEvent("keydown", { key: k, bubbles: true, isComposing }),
    );
  });

describe("TodoComposer", () => {
  it("adds tasks with the chosen project and stays open for the next", async () => {
    const { onOp, onClose } = render();
    expect(chips().map((b) => b.textContent)).toEqual([
      "Personal",
      "JARVIS",
      "AeroGraph",
    ]);
    expect(pressed()).toBe("Personal");
    type("Buy milk");
    await key("Enter");
    expect(onOp).toHaveBeenLastCalledWith({
      kind: "add",
      text: "Buy milk",
      project: null,
    });
    expect(textBox().value).toBe("");
    type("Ship");
    act(() => chip("JARVIS").click());
    await act(async () => button("Add").click());
    expect(onOp).toHaveBeenLastCalledWith({
      kind: "add",
      text: "Ship",
      project: "JARVIS",
    });
    expect(pressed()).toBe("JARVIS");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("edits text and project, then closes; Esc closes without saving", async () => {
    const { onOp, onClose } = render(EDIT);
    expect(textBox().value).toBe("Fix the ring snap");
    expect(pressed()).toBe("JARVIS");
    expect(button("Save")).toBeTruthy();
    type("Fix the snap");
    act(() => chip("AeroGraph").click());
    await key("Enter");
    expect(onOp).toHaveBeenCalledWith({
      kind: "edit",
      line: 1,
      raw: "- [ ] Fix the ring snap @JARVIS 2026-09-27",
      text: "Fix the snap",
      project: "AeroGraph",
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    await key("Escape");
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(onOp).toHaveBeenCalledTimes(1);
  });

  it("keeps a project token that names no workspace as its own chip", () => {
    render({ mode: "edit", todo: task, project: "OldName" });
    expect(pressed()).toBe("OldName");
  });

  it("turns a pasted newline into a space, since a task is one line", () => {
    render();
    type("Buy\n  milk");
    expect(textBox().value).toBe("Buy milk");
  });

  it("writes nothing for an empty add", async () => {
    const { onOp } = render();
    await key("Enter");
    expect(onOp).not.toHaveBeenCalled();
  });

  it("keeps the typed task and shows why when an add is refused", async () => {
    const onOp = vi.fn().mockResolvedValue({ ok: false, error: "EBUSY" });
    render({ mode: "add" }, onOp);
    type("Buy milk");
    await key("Enter");
    expect(textBox().value).toBe("Buy milk");
    expect($('[data-testid="todo-error"]').textContent).toBe(
      "Not saved: EBUSY",
    );
    onOp.mockResolvedValue({ ok: true });
    await key("Enter");
    expect($('[data-testid="todo-error"]')).toBeNull();
  });

  it("stays open when an edit is refused", async () => {
    const { onClose } = render(
      EDIT,
      vi.fn().mockResolvedValue({ ok: false, error: "stale" }),
    );
    await key("Enter");
    expect(onClose).not.toHaveBeenCalled();
    expect($('[data-testid="todo-error"]').textContent).toContain("stale");
  });

  it("ignores Enter while an IME is composing", async () => {
    const { onOp } = render(EDIT);
    await key("Enter", true);
    expect(onOp).not.toHaveBeenCalled();
  });
});
