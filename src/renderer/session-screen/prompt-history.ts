import type { ScreenItem } from "./screen-state";

export type HistoryState = { pos: number | null; saved: string };

export const NOT_BROWSING: HistoryState = { pos: null, saved: "" };

export function historyEntries(items: ScreenItem[]): string[] {
  const entries: string[] = [];
  for (const item of items) {
    if (item.kind === "prompt" && item.text !== entries[entries.length - 1]) {
      entries.push(item.text);
    }
  }
  return entries;
}

/** Returns null when the key should act normally (no history move). */
export function stepHistory(
  entries: string[],
  state: HistoryState,
  current: string,
  dir: "up" | "down",
): { state: HistoryState; text: string } | null {
  if (dir === "up") {
    if (entries.length === 0) return null;
    if (state.pos === null) {
      const pos = entries.length - 1;
      return { state: { pos, saved: current }, text: entries[pos] };
    }
    if (state.pos === 0) return null;
    const pos = state.pos - 1;
    return { state: { pos, saved: state.saved }, text: entries[pos] };
  }
  if (state.pos === null) return null;
  if (state.pos >= entries.length - 1)
    return { state: NOT_BROWSING, text: state.saved };
  const pos = state.pos + 1;
  return { state: { pos, saved: state.saved }, text: entries[pos] };
}

export function onFirstLine(text: string, caret: number): boolean {
  return !text.slice(0, caret).includes("\n");
}

export function onLastLine(text: string, caret: number): boolean {
  return !text.slice(caret).includes("\n");
}
