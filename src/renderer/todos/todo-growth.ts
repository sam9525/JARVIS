import type { TodoList } from "../../shared/types";

// The first list ever received is the baseline, so loading existing tasks at
// startup never counts as growth.
export function todosGrew(prev: TodoList | null, next: TodoList): boolean {
  return prev !== null && next.todos.length > prev.todos.length;
}
