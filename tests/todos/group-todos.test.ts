import { describe, it, expect } from "vitest";
import { groupTodos, PERSONAL } from "../../src/renderer/todos/group-todos";
import type { Todo } from "../../src/shared/types";

const todo = (line: number, project: string | null): Todo => ({
  line,
  raw: `- [ ] t${line}`,
  done: false,
  text: `t${line}`,
  project,
  created: null,
});

describe("groupTodos", () => {
  it("groups by project in first-appearance order, Personal for no @", () => {
    const groups = groupTodos(
      [todo(0, "JARVIS"), todo(1, null), todo(2, "jarvis")],
      ["JARVIS"],
    );
    expect(
      groups.map((g) => [g.key, g.label, g.todos.map((t) => t.line)]),
    ).toEqual([
      ["jarvis", "JARVIS", [0, 2]],
      ["", PERSONAL, [1]],
    ]);
  });

  it("labels a hyphenated token with the workspace's spaced name", () => {
    expect(groupTodos([todo(0, "my-app")], ["My App"])[0].label).toBe("My App");
  });

  it("keeps an unknown project under its own token", () => {
    expect(groupTodos([todo(0, "OldName")], ["JARVIS"])[0].label).toBe(
      "OldName",
    );
  });
});
