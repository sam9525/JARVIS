import type { ScreenEntry } from "../../shared/screen-types";

export type ScreenItem =
  | Exclude<ScreenEntry, { kind: "tool" } | { kind: "result" }>
  | {
      kind: "tool";
      id: string;
      name: string;
      input: Record<string, unknown>;
      result?: { isError: boolean; text: string; patch?: string[] };
    };

type ToolItem = Extract<ScreenItem, { kind: "tool" }>;

/** Folds pushed entries into the item list. A result joins its tool by id and
 *  is dropped when no such tool is known; an entry with a non-empty id already
 *  present is skipped. An empty id means the transcript line had no uuid, so
 *  such entries are always appended. */
export function applyEntries(
  items: ScreenItem[],
  entries: ScreenEntry[],
  reset: boolean,
): ScreenItem[] {
  const next = reset ? [] : [...items];
  const seen = new Set<string>();
  const tools = new Map<string, number>();
  next.forEach((item, i) => {
    if (item.id) seen.add(item.id);
    if (item.kind === "tool") tools.set(item.id, i);
  });

  for (const entry of entries) {
    if (entry.kind === "result") {
      const at = tools.get(entry.toolUseId);
      if (at === undefined) continue;
      const tool = next[at] as ToolItem;
      next[at] = {
        ...tool,
        result: {
          isError: entry.isError,
          text: entry.text,
          ...(entry.patch ? { patch: entry.patch } : {}),
        },
      };
      continue;
    }
    if (entry.id && seen.has(entry.id)) continue;
    if (entry.id) seen.add(entry.id);
    if (entry.kind === "tool") tools.set(entry.id, next.length);
    next.push(entry);
  }
  return next;
}

export function openCalls(items: ScreenItem[]): ToolItem[] {
  return items.filter((i): i is ToolItem => i.kind === "tool" && !i.result);
}

export function patchCounts(patch: string[]): {
  added: number;
  removed: number;
} {
  let added = 0;
  let removed = 0;
  for (const line of patch) {
    if (line.startsWith("+")) added++;
    else if (line.startsWith("-")) removed++;
  }
  return { added, removed };
}
