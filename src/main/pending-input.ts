const PASTE_START = "\x1b[200~";
const PASTE_END = "\x1b[201~";
const BACKSPACES = new Set(["\x7f", "\b"]);
const CLEAR_LINE = "\x15";

// Tracks, per session key, how many characters the user has typed into the
// raw terminal without pressing Enter, so an agent send does not land on top
// of them. The count follows Backspace and Ctrl+U, so a line typed and then
// erased reads as empty again.
export function createPendingInput() {
  const pending = new Map<string, number>();
  const set = (key: string, count: number) => {
    if (count > 0) pending.set(key, count);
    else pending.delete(key);
  };
  return {
    // Returns true when this write submits text the user typed. While a
    // picker is open (a permission prompt or a question), keys choose an
    // option rather than edit the line, so they change nothing.
    note(key: string, data: string, pickerOpen = false): boolean {
      if (pickerOpen) return false;
      // a paste may carry "\r" inside its brackets and does not submit
      if (data.startsWith(PASTE_START)) {
        const pasted = data
          .replaceAll(PASTE_START, "")
          .replaceAll(PASTE_END, "");
        set(key, (pending.get(key) ?? 0) + pasted.length);
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
      let count = pending.get(key) ?? 0;
      for (const ch of data) {
        if (ch === CLEAR_LINE) count = 0;
        else if (BACKSPACES.has(ch)) count = Math.max(0, count - 1);
        else if (ch >= " ") count++;
      }
      set(key, count);
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
