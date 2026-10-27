// Tracks, per session key, whether the user has typed into the raw terminal
// without pressing Enter, so an agent send does not land on top of it.
export function createPendingInput() {
  const pending = new Set<string>();
  return {
    note(key: string, data: string): void {
      if (data.includes("\r") || data.includes("\x03")) {
        pending.delete(key);
        return;
      }
      // focus reports, arrows and mouse are escape sequences, not typing
      if (data === "" || data.startsWith("\x1b")) return;
      pending.add(key);
    },
    clear(key: string): void {
      pending.delete(key);
    },
    has(key: string): boolean {
      return pending.has(key);
    },
  };
}
