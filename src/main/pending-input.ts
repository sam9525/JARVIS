// Tracks, per session key, whether the user has typed into the raw terminal
// without pressing Enter, so an agent send does not land on top of it.
export function createPendingInput() {
  const pending = new Set<string>();
  return {
    // Returns true when this write submits text the user typed.
    note(key: string, data: string): boolean {
      // a paste may carry "\r" inside its brackets and does not submit
      if (data.startsWith("\x1b[200~")) {
        pending.add(key);
        return false;
      }
      if (data.includes("\r") || data.includes("\x03")) {
        const wasPending = pending.has(key);
        pending.delete(key);
        const typedBeforeEnter = data.slice(0, Math.max(data.indexOf("\r"), 0));
        const typedChars =
          typedBeforeEnter !== "" && !typedBeforeEnter.startsWith("\x1b");
        return data.includes("\r") && (wasPending || typedChars);
      }
      // focus reports, arrows and mouse are escape sequences, not typing
      if (data === "" || data.startsWith("\x1b")) return false;
      pending.add(key);
      return false;
    },
    clear(key: string): void {
      pending.delete(key);
    },
    has(key: string): boolean {
      return pending.has(key);
    },
  };
}
