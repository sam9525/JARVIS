const listeners = new Set<(id: string) => void>();

/** Fires with the session key when a person types text or Enter into a
 *  session's terminal, or presses a bare Esc in its session screen. Escape
 *  sequences (arrows, xterm's own focus reports) do not count. */
export function onTerminalTyped(fn: (id: string) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function markTerminalTyped(id: string): void {
  for (const l of listeners) l(id);
}
