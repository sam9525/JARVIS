export type ViewMode = "screen" | "raw";

const modes = new Map<string, ViewMode>();
const autoFlipped = new Set<string>();
const listeners = new Set<(key: string) => void>();

export function getViewMode(key: string): ViewMode {
  return modes.get(key) ?? "screen";
}

/** `auto` marks a flip made by a command that needs the raw terminal. */
export function setViewMode(key: string, mode: ViewMode, auto = false): void {
  modes.set(key, mode);
  if (auto) autoFlipped.add(key);
  else autoFlipped.delete(key);
  for (const l of listeners) l(key);
}

export function clearViewMode(key: string): void {
  modes.delete(key);
  autoFlipped.delete(key);
  for (const l of listeners) l(key);
}

export function wasAutoFlipped(key: string): boolean {
  return autoFlipped.has(key);
}

export function onViewMode(fn: (key: string) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
