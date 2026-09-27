// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/no-explicit-any */
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import TodoToggle from "../../src/renderer/todos/TodoToggle";

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
const render = (el: React.ReactElement) => act(() => root.render(el));
const button = () =>
  container.querySelector('[data-testid="todo-toggle"]') as HTMLElement;
// the static hover:border-accent contains "border-accent" — compare tokens
const tokens = () => button().className.split(/\s+/);

describe("TodoToggle", () => {
  it("is idle while the panel is closed", () => {
    render(<TodoToggle open={false} onToggle={() => undefined} />);
    expect(tokens()).toContain("border-edge");
    expect(tokens()).not.toContain("border-accent");
    expect(button().title).toBe("To-do list");
  });

  it("lights while the panel is open", () => {
    render(<TodoToggle open onToggle={() => undefined} />);
    expect(tokens()).toContain("border-accent");
    expect(button().title).toBe("Close the to-do list");
  });

  it("calls onToggle on click", () => {
    const onToggle = vi.fn();
    render(<TodoToggle open={false} onToggle={onToggle} />);
    act(() => button().click());
    expect(onToggle).toHaveBeenCalledTimes(1);
  });
});
