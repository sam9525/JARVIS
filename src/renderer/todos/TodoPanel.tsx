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
import TodoComposer, { type ComposerDraft } from "./TodoComposer";

const NONE = "";
const ICON_BTN =
  "cursor-pointer px-1 text-ink-dim opacity-0 transition-opacity group-hover:opacity-100 hover:text-accent focus:opacity-100";
const AGE_CLASS: Record<AgeTier, string> = {
  fresh: "text-ink-muted",
  week: "text-ink-dim",
  stale: "text-ink-dim/60",
};

type Composer = { mode: "add" } | { mode: "edit"; todo: Todo };

export default function TodoPanel({
  list,
  projects,
  colors = {},
  onOp,
  onOpenProject,
  onOverflow,
}: {
  list: TodoList;
  projects: string[];
  /** workspace name → its identity colour; a group without one is Personal or a stale token */
  colors?: Record<string, string>;
  onOp(op: TodoOp): Promise<TodoOpResult>;
  onOpenProject?(name: string): void;
  /** the list is this many px taller than its box; the owner grows the panel */
  onOverflow?(px: number): void;
}) {
  const [openFolded, setOpenFolded] = useState(false);
  const [doneFolded, setDoneFolded] = useState(true);
  // an edit holds the whole task, not its line: a row deleted above it shifts
  // the line, and the composer must not reopen on whichever task moved there
  const [composer, setComposer] = useState<Composer | null>(null);
  const [draft, setDraft] = useState<ComposerDraft>({
    text: "",
    project: NONE,
  });
  const [error, setError] = useState<string | null>(null);
  // a ref, not dataTransfer: the drop only needs to know which row left, and
  // the group key is what keeps a row inside its own project
  const dragged = useRef<{ todo: Todo; group: string } | null>(null);
  const scroller = useRef<HTMLDivElement>(null);

  const editGone =
    composer?.mode === "edit" &&
    !list.todos.some(
      (t) => t.line === composer.todo.line && t.raw === composer.todo.raw,
    );
  const active = editGone ? null : composer;

  // grow-only: a shorter list leaves the panel at the height it has; an open
  // composer takes half the box on purpose, so it is not overflow
  useLayoutEffect(() => {
    const el = scroller.current;
    // a box that measures 0 is not laid out; growing it would never converge
    if (!el || !onOverflow || active || el.clientHeight === 0) return;
    const over = el.scrollHeight - el.clientHeight;
    if (over > 0) onOverflow(over);
  }, [list, openFolded, doneFolded, error, active, onOverflow]);

  // the chip for a task: the workspace's spelling when the token names one,
  // the token itself when it names nothing
  const projectValue = (t: Todo): string => {
    if (!t.project) return NONE;
    const k = projectKey(t.project).toLowerCase();
    return projects.find((p) => projectKey(p).toLowerCase() === k) ?? t.project;
  };

  // a refused op keeps what was typed and says why
  const send = async (op: TodoOp): Promise<boolean> => {
    const r = await onOp(op);
    setError(r.ok ? null : `Not saved: ${r.error}`);
    return r.ok;
  };

  const openAdd = () => {
    setComposer({ mode: "add" });
    setDraft({ text: "", project: NONE });
  };

  const submit = async () => {
    if (!active) return;
    if (!draft.text.trim()) {
      if (active.mode === "edit") setComposer(null);
      return;
    }
    const project = draft.project || null;
    if (active.mode === "add") {
      // stays open for the next task, keeping the chosen project
      if (await send({ kind: "add", text: draft.text, project }))
        setDraft({ ...draft, text: "" });
      return;
    }
    const t = active.todo;
    const ok = await send({
      kind: "edit",
      line: t.line,
      raw: t.raw,
      text: draft.text,
      project,
    });
    if (ok) setComposer(null);
  };

  // ponytail: read at render, so an open panel keeps yesterday's ages until
  // the list or a fold next re-renders it
  const now = new Date();

  const row = (t: Todo, group: string) => {
    const age = taskAge(t.created, now);
    const editing =
      active?.mode === "edit" &&
      active.todo.line === t.line &&
      active.todo.raw === t.raw;
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
        className={`group flex items-center gap-2 px-2 py-0.5 ${editing ? "bg-accent/10" : "hover:bg-edge/30"}`}
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
          onClick={() => {
            setComposer({ mode: "edit", todo: t });
            setDraft({ text: t.text, project: projectValue(t) });
          }}
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
        if (e.key !== "n" || active || typing) return;
        e.preventDefault();
        openAdd();
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
        {!active && (
          <button
            title="New task (N)"
            onClick={openAdd}
            className="absolute right-2.5 bottom-2.5 grid h-7 w-7 cursor-pointer place-items-center border border-accent bg-abyss text-[17px] leading-none text-accent shadow-[0_0_10px_rgba(34,211,238,0.35)] hover:bg-accent hover:text-abyss"
          >
            +
          </button>
        )}
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
      {active && (
        <TodoComposer
          mode={active.mode}
          draft={draft}
          projects={projects}
          colors={colors}
          onChange={setDraft}
          onSubmit={() => void submit()}
          onClose={() => setComposer(null)}
        />
      )}
    </div>
  );
}
