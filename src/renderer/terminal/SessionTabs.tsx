import React, { useMemo, useRef } from "react";
import Segmented from "../ui/Segmented";
import { LBL_DIM } from "../ui/hud";
import { MAX_SESSIONS } from "../../shared/session-key";
import { PILL } from "./status-colours";
import type { StatusKind } from "../../shared/types";

const Dot = ({ kind }: { kind: StatusKind }) => (
  <span
    data-testid="session-dot"
    title={kind}
    className={`inline-block h-2 w-2 flex-none rounded-full border ${PILL[kind]}`}
  />
);

type Tab = {
  key: string;
  label: string;
  kind: StatusKind;
  main?: boolean;
  hint?: string;
};

// One tab per session, drawn by the app's one segmented control stretched
// across the title bar. A lone session shows only its status dot beside the
// title: there is nothing to switch to. The title bar starts a drag on
// pointerdown, so presses here stop before they reach it.
export default function SessionTabs({
  tabs,
  value,
  onSelect,
  onNew,
  onClose,
}: {
  tabs: Tab[];
  value: string;
  onSelect(key: string): void;
  onNew?(): void;
  onClose?(key: string): void;
}) {
  // A key that joins the tabs already selected was opened from `+`; it reads
  // "new" until the user selects another tab. Refs, not state: this is derived
  // from the props of consecutive renders.
  const known = useRef<Set<string> | null>(null);
  const fresh = useRef<string | null>(null);
  if (known.current)
    for (const t of tabs) if (!known.current.has(t.key)) fresh.current = t.key;
  known.current = new Set(tabs.map((t) => t.key));
  if (fresh.current !== value) fresh.current = null;
  const freshKey = fresh.current;

  // Segmented re-measures its fill whenever `options` changes identity, and
  // the owner re-renders on every hook event. The options are rebuilt only when
  // what they show changes: `shape` is every field they read, and the tabs and
  // close handler come through refs, so the deps below are complete.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const canClose = onClose !== undefined;
  // words give way to width: the state is spelled out with two tabs, hints
  // last until the cap, and the dot always stays
  const spellKind = tabs.length === 2;
  const showHints = tabs.length < MAX_SESSIONS;
  const shape = tabs
    .map((t) => [t.key, t.label, t.kind, t.main, t.hint].join("\u0000"))
    .join("\u0001");
  const options = useMemo(
    () =>
      tabsRef.current.map((t) => {
        // a hidden session that wants you shows it in its label, not only
        // in its dot
        const calling =
          t.key !== value && (t.kind === "asking" || t.kind === "blocked");
        return {
          value: t.key,
          label: (
            <span
              data-tab={t.key}
              data-label={t.label}
              className={
                "flex w-full min-w-0 items-center gap-1.5" +
                (calling ? " text-warm" : "")
              }
            >
              <Dot kind={t.kind} />
              <span className="truncate">{t.label}</span>
              {showHints && t.hint && (
                <span className="truncate text-ink-dim">· {t.hint}</span>
              )}
              {spellKind && t.kind !== "none" && (
                <span className="text-ink-dim">· {t.kind}</span>
              )}
              {t.key === freshKey && (
                <span className="text-ink-dim">· new</span>
              )}
              {canClose && !t.main && (
                // a span, not a button: the whole tab is already a button
                <span
                  role="button"
                  data-close={t.key}
                  title="Close session"
                  className="ml-auto pl-1 text-ink-dim hover:text-accent"
                  onClick={(e) => {
                    e.stopPropagation();
                    closeRef.current?.(t.key);
                  }}
                >
                  ✕
                </span>
              )}
            </span>
          ),
        };
      }),
    [shape, canClose, spellKind, showHints, freshKey, value],
  );

  return (
    <div
      // -my-1 cancels the title bar's padding, so the tabs run its full height
      className="-my-1 flex min-w-0 flex-1 items-stretch self-stretch"
      onPointerDown={(e) => e.stopPropagation()}
    >
      {tabs.length === 1 ? (
        <span className="flex flex-1 items-center">
          <Dot kind={tabs[0].kind} />
        </span>
      ) : (
        <Segmented
          options={options}
          value={value}
          onChange={onSelect}
          stretch
        />
      )}
      {onNew && tabs.length < MAX_SESSIONS && (
        <button
          data-testid="session-new"
          title="New session"
          className={
            LBL_DIM +
            " cursor-pointer border-l border-accent/20 px-2.5 hover:text-accent"
          }
          onClick={onNew}
        >
          +
        </button>
      )}
    </div>
  );
}
