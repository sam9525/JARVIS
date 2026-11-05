import type { StatusLineView } from "../../shared/types";
import { MODELS } from "./composer-logic";
import { applyEntries, type ScreenItem } from "./screen-state";

// Per session key, for the life of the window: a tab switch reads these back
// instead of refetching, and pushes for a session not on screen still land.
const items = new Map<string, ScreenItem[]>();
const views = new Map<string, StatusLineView | null>();
const loaded = new Set<string>();
const listeners = new Set<(key: string) => void>();
let subscribed = false;

const NO_ITEMS: ScreenItem[] = [];

function emit(key: string): void {
  for (const l of listeners) l(key);
}

// Permanent by design, like terminal-registry's pty listeners: the caches
// above must keep folding pushes whether or not a panel is mounted.
function ensureSubscribed(): void {
  if (subscribed) return;
  subscribed = true;
  window.jarvis.onTranscript((key, entries, reset) => {
    items.set(key, applyEntries(items.get(key) ?? [], entries, reset));
    // An empty reset is main dropping the session (closed, exited or switched
    // to a file not written yet), so its next showing fetches afresh.
    if (reset && entries.length === 0) loaded.delete(key);
    emit(key);
  });
  // null is main forgetting the session's status line.
  window.jarvis.onStatusLine((key, view) => {
    if (view === null) views.delete(key);
    else views.set(key, view);
    emit(key);
  });
}

/** Subscribes once, then loads the session's transcript and status line on
 *  its first showing. The snapshot replaces what pushes built so far: main
 *  answers after every push it sent before, so the snapshot already holds them. */
export function loadSession(key: string): void {
  ensureSubscribed();
  if (loaded.has(key)) return;
  loaded.add(key);
  window.jarvis
    .getTranscript(key)
    .then((entries) => {
      items.set(key, applyEntries([], entries, true));
      emit(key);
    })
    .catch(() => loaded.delete(key));
  window.jarvis
    .getStatusLine(key)
    .then((view) => {
      if (view === null && views.has(key)) return;
      views.set(key, view);
      emit(key);
    })
    .catch((): void => undefined);
}

export function itemsFor(key: string): ScreenItem[] {
  return items.get(key) ?? NO_ITEMS;
}

export function statusLineFor(key: string): StatusLineView | null {
  return views.get(key) ?? null;
}

export function onSessionFeed(fn: (key: string) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** The model the status line names, as one of the picker's values, else "". */
export function modelOf(view: StatusLineView | null): string {
  const name = view?.model.toLowerCase() ?? "";
  return MODELS.find((m) => name.includes(m.value))?.value ?? "";
}
