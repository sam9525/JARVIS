import React from "react";

const NO_HUE = "#5a7a8a";

export interface ComposerDraft {
  text: string;
  project: string; // "" = Personal
}

export default function TodoComposer({
  mode,
  draft,
  projects,
  colors,
  onChange,
  onSubmit,
  onClose,
}: {
  mode: "add" | "edit";
  draft: ComposerDraft;
  projects: string[];
  colors: Record<string, string>;
  onChange(draft: ComposerDraft): void;
  onSubmit(): void;
  onClose(): void;
}) {
  // a token that names no workspace still shows, so an edit never silently
  // drops a project the list does not know
  const choices =
    draft.project && !projects.includes(draft.project)
      ? [...projects, draft.project]
      : projects;
  const chip = (value: string, label: string) => {
    const hue = colors[value] ?? NO_HUE;
    const selected = draft.project === value;
    return (
      <button
        key={label}
        type="button"
        aria-pressed={selected}
        onClick={() => onChange({ ...draft, project: value })}
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
      className="flex min-h-0 flex-1 flex-col gap-2 border-t border-accent/50 bg-gradient-to-b from-accent/5 to-transparent px-2.5 pt-2 pb-2.5"
    >
      <div className="flex items-center text-[11px] font-medium tracking-[0.16em] text-accent-soft">
        {mode === "add" ? "NEW TASK" : "EDIT TASK"}
        <button
          type="button"
          title="Close"
          onClick={onClose}
          className="ml-auto cursor-pointer text-ink-dim hover:text-accent"
        >
          ✕
        </button>
      </div>
      <textarea
        autoFocus
        aria-label="Task text"
        placeholder="What needs doing?"
        value={draft.text}
        // one task is one line of TODO.md: a pasted newline becomes a space
        onChange={(e) =>
          onChange({ ...draft, text: e.target.value.replace(/\s*\n\s*/g, " ") })
        }
        onKeyDown={(e) => {
          // the composer owns Enter and Esc; the app's own Esc must not
          // clear the deck from inside a text field
          if (e.key === "Enter" && !e.nativeEvent.isComposing) {
            e.preventDefault();
            onSubmit();
          }
          if (e.key === "Escape") {
            e.stopPropagation();
            onClose();
          }
        }}
        className="min-h-16 flex-1 resize-none rounded border border-accent bg-abyss px-2 py-1.5 text-[13px] leading-normal text-ink outline-none"
      />
      <div className="flex flex-wrap gap-1.5">
        {chip("", "Personal")}
        {choices.map((p) => chip(p, p))}
      </div>
      <div className="flex items-center gap-2 text-[10.5px] text-ink-dim">
        <span>Enter to {mode === "add" ? "add" : "save"} · Esc to close</span>
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
          onClick={onSubmit}
          className="cursor-pointer rounded border border-accent px-2.5 py-0.5 text-[11.5px] text-accent"
        >
          {mode === "add" ? "Add" : "Save"}
        </button>
      </div>
    </div>
  );
}
