import React, { useLayoutEffect, useRef, useState } from "react";
import {
  projectKey,
  type Todo,
  type TodoList,
  type TodoOp,
  type TodoOpResult,
} from "../../shared/types";
import { groupTodos } from "./group-todos";
import { taskAge, type AgeTier } from "./task-age";

const NONE = "";
const ICON_BTN =
  "cursor-pointer px-1 text-ink-dim opacity-0 transition-opacity group-hover:opacity-100 hover:text-accent focus:opacity-100";
const AGE_CLASS: Record<AgeTier, string> = {
  fresh: "text-ink-muted",
  week: "text-ink-dim",
  stale: "text-ink-dim/60",
};

export default function TodoPanel({
  list,
  projects,
  colors = {},
  editing = null,
  onOp,
  onNew,
  onEdit,
  onOpenProject,
  onOverflow,
}: {
  list: TodoList;
  projects: string[];
  /** workspace name → its identity colour; a group without one is Personal or a stale token */
  colors?: Record<string, string>;
  /** the task the composer beside this panel is editing, lit so you can see which */
  editing?: Todo | null;
  onOp(op: TodoOp): Promise<TodoOpResult>;
  onNew(): void;
  /** `project` is the chip to preselect: "" for Personal */
  onEdit(todo: Todo, project: string): void;
  onOpenProject?(name: string): void;
  /** the list is this many px taller than its box; the owner grows the panel */
  onOverflow?(px: number): void;
}) {
  const [openFolded, setOpenFolded] = useState(false);
  const [doneFolded, setDoneFolded] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // a ref, not dataTransfer: the drop only needs to know which row left, and
  // the group key is what keeps a row inside its own project
  const dragged = useRef<{ todo: Todo; group: string } | null>(null);
  const scroller = useRef<HTMLDivElement>(null);

  // grow-only: a shorter list leaves the panel at the height it has
  useLayoutEffect(() => {
    const el = scroller.current;
    // a box that measures 0 is not laid out; growing it would never converge
    if (!el || !onOverflow || el.clientHeight === 0) return;
    const over = el.scrollHeight - el.clientHeight;
    if (over > 0) onOverflow(over);
  }, [list, openFolded, doneFolded, error, onOverflow]);

  // the chip for a task: the workspace's spelling when the token names one,
  // the token itself when it names nothing
  const projectValue = (t: Todo): string => {
    if (!t.project) return NONE;
    const k = projectKey(t.project).toLowerCase();
    return projects.find((p) => projectKey(p).toLowerCase() === k) ?? t.project;
  };

  // a refused op says why
  const send = async (op: TodoOp): Promise<boolean> => {
    const r = await onOp(op);
    setError(r.ok ? null : `Not saved: ${r.error}`);
    return r.ok;
  };

  // ponytail: read at render, so an open panel keeps yesterday's ages until
  // the list or a fold next re-renders it
  const now = new Date();

  const row = (t: Todo, group: string) => {
    const age = taskAge(t.created, now);
    const lit = editing?.line === t.line && editing.raw === t.raw;
    return (
      <li
        key={t.line}
        data-testid="todo-row"
        draggable
        onDragStart={() => (dragged.current = { todo: t, group })}
        onDragEnd={() => {
          dragged.current = null;
        }}
        onDragOver={(e) => {
          if (dragged.current?.group === group) e.preventDefault();
        }}
        onDrop={(e) => {
          e.preventDefault();
          const from = dragged.current;
          dragged.current = null;
          if (!from || from.group !== group || from.todo.line === t.line)
            return;
          void send({
            kind: "move",
            line: from.todo.line,
            raw: from.todo.raw,
            toLine: t.line,
            toRaw: t.raw,
          });
        }}
        className={`group flex items-center gap-2 px-2 py-0.5 ${lit ? "bg-accent/10" : "hover:bg-edge/30"}`}
      >
        <input
          type="checkbox"
          checked={t.done}
          aria-label={`Done: ${t.text}`}
          onChange={() =>
            void send({ kind: "toggle", line: t.line, raw: t.raw })
          }
          className="cursor-pointer accent-cyan-400"
        />
        <span
          className={`min-w-0 flex-1 truncate ${t.done ? "text-ink-dim line-through" : age?.tier === "stale" ? "text-ink-muted" : "text-ink"}`}
        >
          {t.text}
        </span>
        {age && (
          <span
            title={t.created ?? undefined}
            className={`shrink-0 text-[10px] tabular-nums ${AGE_CLASS[age.tier]}`}
          >
            {age.label}
          </span>
        )}
        <button
          title="Edit"
          className={ICON_BTN}
          onClick={() => onEdit(t, projectValue(t))}
        >
          ✎
        </button>
        <button
          title="Delete"
          className={ICON_BTN}
          onClick={() =>
            void send({ kind: "delete", line: t.line, raw: t.raw })
          }
        >
          🗑
        </button>
      </li>
    );
  };

  const header = (label: string, count: number) => {
    const color = colors[label];
    return (
      <div className="group/header flex items-center gap-1.5 px-4 pt-1 text-[11px] text-ink-muted">
        <span
          className={`h-3 w-[3px] shrink-0 ${color ? "" : "bg-ink-dim"}`}
          style={
            color
              ? { background: color, boxShadow: `0 0 6px ${color}` }
              : undefined
          }
        />
        <span data-testid="todo-group-name">{label}</span>
        <span className="rounded-full border border-edge px-1.5 text-[10px] tabular-nums">
          {count}
        </span>
        {color && onOpenProject && (
          <button
            title={`Open ${label}`}
            onClick={() => onOpenProject(label)}
            className="ml-auto cursor-pointer pr-2 text-[10px] text-ink-dim opacity-0 transition-opacity group-hover/header:opacity-100 hover:text-accent focus:opacity-100"
          >
            open ↗
          </button>
        )}
      </div>
    );
  };

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
            {header(g.label, g.todos.length)}
            <ul className="pl-3">
              {g.todos.map((t) => row(t, `${id}:${g.key}`))}
            </ul>
          </div>
        ))}
    </section>
  );

  const open = list.todos.filter((t) => !t.done);
  const done = list.todos.filter((t) => t.done);

  return (
    <div
      className="flex h-full flex-col text-[12px]"
      onKeyDown={(e) => {
        // a ticked checkbox keeps focus, so only text fields swallow N
        const typing = (e.target as HTMLElement).matches(
          "textarea, input:not([type=checkbox])",
        );
        if (e.key !== "n" || typing) return;
        e.preventDefault();
        onNew();
      }}
    >
      <div className="relative min-h-0 flex-1">
        <div ref={scroller} className="h-full overflow-y-auto">
          {section("open", "TO DO", open, openFolded, () =>
            setOpenFolded((v) => !v),
          )}
          {section("done", "DONE", done, doneFolded, () =>
            setDoneFolded((v) => !v),
          )}
        </div>
        <button
          title="New task (N)"
          onClick={onNew}
          className="absolute right-2.5 bottom-2.5 grid h-7 w-7 cursor-pointer place-items-center border border-accent bg-abyss text-[17px] leading-none text-accent shadow-[0_0_10px_rgba(34,211,238,0.35)] hover:bg-accent hover:text-abyss"
        >
          +
        </button>
      </div>
      {error && (
        <div
          data-testid="todo-error"
          role="alert"
          className="px-2 pt-1 text-[11.5px] text-ink-dim"
        >
          {error}
        </div>
      )}
    </div>
  );
}
