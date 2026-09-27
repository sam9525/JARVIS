import { projectKey, type Todo } from "../../shared/types";

export interface TodoGroup {
  key: string;
  label: string;
  todos: Todo[];
}

export const PERSONAL = "Personal";

// A token that names no workspace keeps its own header, so a renamed
// project's tasks stay visible under the old name instead of vanishing.
export function groupTodos(todos: Todo[], workspaceNames: string[]): TodoGroup[] {
  const names = new Map(
    workspaceNames.map((n) => [projectKey(n).toLowerCase(), n]),
  );
  const groups = new Map<string, TodoGroup>();
  for (const t of todos) {
    const key = t.project ? projectKey(t.project).toLowerCase() : "";
    let group = groups.get(key);
    if (!group) {
      const label = t.project ? (names.get(key) ?? t.project) : PERSONAL;
      group = { key, label, todos: [] };
      groups.set(key, group);
    }
    group.todos.push(t);
  }
  return [...groups.values()];
}