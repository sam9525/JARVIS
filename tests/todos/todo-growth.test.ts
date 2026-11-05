import { describe, it, expect } from "vitest";
import { todosGrew } from "../../src/renderer/todos/todo-growth";
import type { Todo, TodoList } from "../../src/shared/types";

const list = (count: number): TodoList =>
  ({
    todos: Array.from({ length: count }, (_, i) => ({ line: i }) as Todo),
  }) as TodoList;

describe("todosGrew", () => {
  it("is false for the first list", () => {
    expect(todosGrew(null, list(2))).toBe(false);
  });
  it("is true when a task was added", () => {
    expect(todosGrew(list(2), list(3))).toBe(true);
  });
  it("is false when the count is unchanged", () => {
    expect(todosGrew(list(3), list(3))).toBe(false);
  });
  it("is false when the list shrank", () => {
    expect(todosGrew(list(3), list(2))).toBe(false);
  });
});
