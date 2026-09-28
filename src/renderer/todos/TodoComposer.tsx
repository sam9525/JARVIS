import React, { useState } from "react";
import type { Todo, TodoOp, TodoOpResult } from "../../shared/types";

const NO_HUE = "#5a7a8a";

/** what the composer was opened for; `project` is "" for Personal */
export type ComposeRequest =
  { mode: "add" } | { mode: "edit"; todo: Todo; project: string };

// Mounted fresh for each request (the owner keys it), so the draft starts
// from the request and never from whatever the last one left behind.
export default function TodoComposer({
  request,
  projects,
  colors,
  onOp,
  onClose,
}: {
  request: ComposeRequest;
  projects: string[];
  colors: Record<string, string>;
  onOp(op: TodoOp): Promise<TodoOpResult>;
  onClose(): void;
}) {
  const [text, setText] = useState(
    request.mode === "edit" ? request.todo.text : "",
  );
  const [project, setProject] = useState(
    request.mode === "edit" ? request.project : "",
  );
  const [error, setError] = useState<string | null>(null);

  // a refused op keeps what was typed and says why
  const submit = async () => {
    if (!text.trim()) {
      if (request.mode === "edit") onClose();
      return;
    }
    const op: TodoOp =
      request.mode === "add"
        ? { kind: "add", text, project: project || null }
        : {
            kind: "edit",
            line: request.todo.line,
            raw: request.todo.raw,
            text,
            project: project || null,
          };
    const r = await onOp(op);
    setError(r.ok ? null : `Not saved: ${r.error}`);
    if (!r.ok) return;
    // an add stays open for the next task, keeping the chosen project
    if (request.mode === "add") setText("");
    else onClose();
  };

  // a token that names no workspace still shows, so an edit never silently
  // drops a project the list does not know
  const choices =
    project && !projects.includes(project) ? [...projects, project] : projects;
  const chip = (value: string, label: string) => {
    const hue = colors[value] ?? NO_HUE;
    const selected = project === value;
    return (
      <button
        key={label}
        type="button"
        aria-pressed={selected}
        onClick={() => setProject(value)}
        style={
          selected
            ? {
                borderColor: hue,
                background: `color-mix(in srgb, ${hue} 14%, transparent)`,
              }
            : undefined
        }
        className={`inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-edge py-px pr-2 pl-1.5 text-[11px] ${selected ? "text-ink" : "text-ink-muted hover:text-ink"}`}
      >
        <span
          className="h-[7px] w-[7px] rounded-full"
          style={{ background: hue }}
        />
        {label}
      </button>
    );
  };

  return (
    <div
      data-testid="todo-composer"
      className="flex h-full flex-col gap-2 px-2.5 pt-2 pb-2.5 text-[12px]"
    >
      <textarea
        autoFocus
        aria-label="Task text"
        placeholder="What needs doing?"
        value={text}
        // one task is one line of TODO.md: a pasted newline becomes a space
        onChange={(e) => setText(e.target.value.replace(/\s*\n\s*/g, " "))}
        onKeyDown={(e) => {
          // the composer owns Enter and Esc; an open preview's window-level
          // Esc must not close it from inside a text field
          if (e.key === "Enter" && !e.nativeEvent.isComposing) {
            e.preventDefault();
            void submit();
          }
          if (e.key === "Escape") {
            e.stopPropagation();
            onClose();
          }
        }}
        className="min-h-20 flex-1 resize-none rounded border border-accent bg-abyss px-2 py-1.5 text-[13px] leading-normal text-ink outline-none"
      />
      <div className="flex flex-wrap gap-1.5">
        {chip("", "Personal")}
        {choices.map((p) => chip(p, p))}
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
      <div className="flex items-center gap-2 text-[10.5px] text-ink-dim">
        <span>
          Enter to {request.mode === "add" ? "add" : "save"} · Esc to close
        </span>
        <span className="flex-1" />
        <button
          type="button"
          onClick={onClose}
          className="cursor-pointer rounded border border-edge px-2.5 py-0.5 text-[11.5px] text-ink-muted hover:text-ink"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => void submit()}
          className="cursor-pointer rounded border border-accent px-2.5 py-0.5 text-[11.5px] text-accent"
        >
          {request.mode === "add" ? "Add" : "Save"}
        </button>
      </div>
    </div>
  );
}
