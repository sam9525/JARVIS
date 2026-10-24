import React, { useMemo, useRef } from "react";
import Segmented from "../ui/Segmented";
import { LBL_DIM } from "../ui/hud";
import { MAX_SESSIONS } from "../../shared/session-key";
import { PILL } from "./status-colours";
import type { StatusKind } from "../../shared/types";

type Tab = {
  key: string;
  label: string;
  kind: StatusKind;
  main?: boolean;
  hint?: string;
};

// One tab per session, drawn by the app's one segmented control. It sits in
// the panel's title bar, which starts a drag on pointerdown, so presses here
// stop before they reach it.
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
  // Segmented re-measures its fill whenever `options` changes identity, and
  // the owner re-renders on every hook event. The options are rebuilt only when
  // what they show changes: `shape` is every field they read, and the tabs and
  // close handler come through refs, so the deps below are complete.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const canClose = onClose !== undefined;
  const shape = tabs
    .map((t) => [t.key, t.label, t.kind, t.main, t.hint].join("\u0000"))
    .join("\u0001");
  const options = useMemo(
    () =>
      tabsRef.current.map((t) => ({
        value: t.key,
        label: (
          <span
            data-tab={t.key}
            data-label={t.label}
            className="flex items-center gap-1.5"
          >
            <span
              data-testid="session-dot"
              className={`inline-block h-2 w-2 flex-none rounded-full border ${PILL[t.kind]}`}
            />
            {t.label}
            {t.hint && <span className="text-ink-dim">· {t.hint}</span>}
            {canClose && !t.main && (
              // a span, not a button: the whole tab is already a button
              <span
                role="button"
                data-close={t.key}
                title="Close session"
                className="ml-0.5 text-ink-dim hover:text-accent"
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
      })),
    [shape, canClose],
  );

  return (
    <div
      className="flex items-center gap-1.5"
      onPointerDown={(e) => e.stopPropagation()}
    >
      <Segmented options={options} value={value} onChange={onSelect} />
      {onNew && tabs.length < MAX_SESSIONS && (
        <button
          data-testid="session-new"
          title="New session"
          className={LBL_DIM + " cursor-pointer px-1.5 py-1 hover:text-accent"}
          onClick={onNew}
        >
          +
        </button>
      )}
    </div>
  );
}
