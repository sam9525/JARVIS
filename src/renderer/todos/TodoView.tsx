import React, { useState } from "react";
import type { Todo, TodoOp, TodoOpResult } from "../../shared/types";

const NO_HUE = "#5a7a8a";

/** One task read in full, with the two things you can do to it from here. */
export default function TodoView({
  todo,
  project,
  colors,
  onOp,
  onEdit,
  onClose,
}: {
  todo: Todo;
  /** "" for Personal */
  project: string;
  colors: Record<string, string>;
  onOp(op: TodoOp): Promise<TodoOpResult>;
  onEdit(): void;
  onClose(): void;
}) {
  const [error, setError] = useState<string | null>(null);

  const remove = async () => {
    const r = await onOp({ kind: "delete", line: todo.line, raw: todo.raw });
    if (r.ok) onClose();
    else setError(`Not deleted: ${r.error}`);
  };

  return (
    <div
      data-testid="todo-view"
      className="flex h-full flex-col gap-2 px-2.5 pt-2 pb-2.5 text-[12px]"
    >
      <p
        className={`min-h-0 flex-1 overflow-y-auto text-[13px] leading-normal break-words whitespace-pre-wrap ${todo.done ? "text-ink-dim line-through" : "text-ink"}`}
      >
        {todo.text}
      </p>
      <div className="flex flex-wrap items-center gap-2 text-[11px] text-ink-muted">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-edge py-px pr-2 pl-1.5">
          <span
            className="h-[7px] w-[7px] rounded-full"
            style={{ background: colors[project] ?? NO_HUE }}
          />
          {project || "Personal"}
        </span>
        {todo.created && <span className="tabular-nums">{todo.created}</span>}
        <span>{todo.done ? "Done" : "Open"}</span>
      </div>
      {error && (
        <div
          data-testid="todo-error"
          role="alert"
          className="text-[11.5px] text-ink-dim"
        >
          {error}
        </div>
      )}
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => void remove()}
          className="cursor-pointer rounded border border-edge px-2.5 py-0.5 text-[11.5px] text-ink-muted hover:text-ink"
        >
          Delete
        </button>
        <button
          type="button"
          onClick={onEdit}
          className="cursor-pointer rounded border border-accent px-2.5 py-0.5 text-[11.5px] text-accent"
        >
          Edit
        </button>
      </div>
    </div>
  );
}
