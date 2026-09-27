import React, { useRef, useState } from "react";
import {
  projectKey,
  type Todo,
  type TodoList,
  type TodoOp,
} from "../../shared/types";
import { groupTodos } from "./group-todos";

const NONE = "";
const ICON_BTN =
  "cursor-pointer px-1 text-ink-dim opacity-0 transition-opacity group-hover:opacity-100 hover:text-accent focus:opacity-100";
const FIELD =
  "rounded border border-edge bg-abyss px-1.5 py-0.5 text-[12px] text-ink outline-none focus:border-accent";

function ProjectSelect({
  value,
  options,
  onChange,
}: {
  value: string;
  options: string[];
  onChange(value: string): void;
}) {
  return (
    <select
      aria-label="Project"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={FIELD}
    >
      <option value={NONE}>none</option>
      {options.map((p) => (
        <option key={p} value={p}>
          {p}
        </option>
      ))}
    </select>
  );
}

export default function TodoPanel({
  list,
  projects,
  onOp,
}: {
  list: TodoList;
  projects: string[];
  onOp(op: TodoOp): void;
}) {
  const [openFolded, setOpenFolded] = useState(false);
  const [doneFolded, setDoneFolded] = useState(true);
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState({ text: "", project: NONE });
  const [newText, setNewText] = useState("");
  const [newProject, setNewProject] = useState(NONE);
  // a ref, not dataTransfer: the drop only needs to know which row left, and
  // the group key is what keeps a row inside its own project
  const dragged = useRef<{ todo: Todo; group: string } | null>(null);

  // the dropdown's value for a task: the workspace's spelling when the token
  // names one, the token itself when it names nothing
  const projectValue = (t: Todo): string => {
    if (!t.project) return NONE;
    const k = projectKey(t.project).toLowerCase();
    return projects.find((p) => projectKey(p).toLowerCase() === k) ?? t.project;
  };
  const optionsWith = (extra: string) =>
    extra && !projects.includes(extra) ? [...projects, extra] : projects;

  const saveEdit = (t: Todo) => {
    setEditing(null);
    if (!draft.text.trim()) return;
    onOp({
      kind: "edit",
      line: t.line,
      raw: t.raw,
      text: draft.text,
      project: draft.project || null,
    });
  };

  const row = (t: Todo, group: string) =>
    editing === t.line ? (
      <li
        key={t.line}
        data-testid="todo-editor"
        className="flex items-center gap-2 px-2 py-0.5"
      >
        <input
          autoFocus
          aria-label="Task text"
          value={draft.text}
          onChange={(e) => setDraft({ ...draft, text: e.target.value })}
          onKeyDown={(e) => {
            // the panel owns Enter and Esc here; the app's own Esc must not
            // clear the deck from inside a text field
            if (e.key === "Enter") saveEdit(t);
            if (e.key === "Escape") {
              e.stopPropagation();
              setEditing(null);
            }
          }}
          className={`min-w-0 flex-1 ${FIELD}`}
        />
        <ProjectSelect
          value={draft.project}
          options={optionsWith(draft.project)}
          onChange={(project) => setDraft({ ...draft, project })}
        />
      </li>
    ) : (
      <li
        key={t.line}
        data-testid="todo-row"
        draggable
        onDragStart={() => (dragged.current = { todo: t, group })}
        onDragOver={(e) => {
          if (dragged.current?.group === group) e.preventDefault();
        }}
        onDrop={(e) => {
          e.preventDefault();
          const from = dragged.current;
          dragged.current = null;
          if (!from || from.group !== group || from.todo.line === t.line) return;
          onOp({
            kind: "move",
            line: from.todo.line,
            raw: from.todo.raw,
            toLine: t.line,
            toRaw: t.raw,
          });
        }}
        className="group flex items-center gap-2 px-2 py-0.5 hover:bg-edge/30"
      >
        <input
          type="checkbox"
          checked={t.done}
          aria-label={`Done: ${t.text}`}
          onChange={() => onOp({ kind: "toggle", line: t.line, raw: t.raw })}
          className="cursor-pointer accent-cyan-400"
        />
        <span
          className={`min-w-0 flex-1 truncate ${t.done ? "text-ink-dim line-through" : "text-ink"}`}
        >
          {t.text}
        </span>
        {t.created && (
          <span className="shrink-0 text-[10px] text-ink-dim">{t.created}</span>
        )}
        <button
          title="Edit"
          className={ICON_BTN}
          onClick={() => {
            setEditing(t.line);
            setDraft({ text: t.text, project: projectValue(t) });
          }}
        >
          ✎
        </button>
        <button
          title="Delete"
          className={ICON_BTN}
          onClick={() => onOp({ kind: "delete", line: t.line, raw: t.raw })}
        >
          🗑
        </button>
      </li>
    );

  const section = (
    id: "open" | "done",
    title: string,
    items: Todo[],
    folded: boolean,
    toggle: () => void,
  ) => (
    <section data-testid={`todo-${id}`} className="py-1">
      <button
        onClick={toggle}
        className="w-full cursor-pointer px-2 py-1 text-left text-[11px] font-semibold tracking-widest text-ink-muted hover:text-accent"
      >
        {folded ? "▸" : "▾"} {title} ({items.length})
      </button>
      {!folded &&
        groupTodos(items, projects).map((g) => (
          <div key={g.key} data-testid="todo-group" className="pb-1">
            <div className="px-4 pt-1 text-[11px] text-ink-dim">{g.label}</div>
            <ul className="pl-3">{g.todos.map((t) => row(t, `${id}:${g.key}`))}</ul>
          </div>
        ))}
    </section>
  );

  const open = list.todos.filter((t) => !t.done);
  const done = list.todos.filter((t) => t.done);

  return (
    <div className="flex h-full flex-col text-[12px]">
      <div className="min-h-0 flex-1 overflow-y-auto">
        {section("open", "TO DO", open, openFolded, () => setOpenFolded((v) => !v))}
        {section("done", "DONE", done, doneFolded, () => setDoneFolded((v) => !v))}
      </div>
      <form
        data-testid="todo-add"
        onSubmit={(e) => {
          e.preventDefault();
          if (!newText.trim()) return;
          onOp({ kind: "add", text: newText, project: newProject || null });
          setNewText("");
        }}
        className="flex items-center gap-2 border-t border-edge p-2"
      >
        <input
          aria-label="New task"
          placeholder="new task…"
          value={newText}
          onChange={(e) => setNewText(e.target.value)}
          className={`min-w-0 flex-1 ${FIELD}`}
        />
        <ProjectSelect
          value={newProject}
          options={projects}
          onChange={setNewProject}
        />
        <button
          type="submit"
          title="Add task"
          className="cursor-pointer rounded border border-edge px-2 text-accent hover:border-accent"
        >
          +
        </button>
      </form>
    </div>
  );
}