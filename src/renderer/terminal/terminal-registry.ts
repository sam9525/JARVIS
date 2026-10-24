import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";

export type Entry = { term: Terminal; fit: FitAddon; el: HTMLDivElement };

// Module-level and keyed by session key, so terminals (and their scrollback)
// survive tab and workspace switches and panel collapse/expand — the panel
// only attaches them.
const entries = new Map<string, Entry>();
// keys whose terminal is freed as soon as the panel detaches it
const doomed = new Set<string>();
const exitListeners = new Set<(id: string, code: number) => void>();
const typedListeners = new Set<(id: string) => void>();
let subscribed = false;

/** Fires with the session key when a person types text or Enter into a
 *  session's terminal. Escape sequences (arrows, xterm's own focus reports)
 *  do not count. */
export function onTerminalTyped(fn: (id: string) => void): () => void {
  typedListeners.add(fn);
  return () => typedListeners.delete(fn);
}

export function onTerminalExit(
  fn: (id: string, code: number) => void,
): () => void {
  exitListeners.add(fn);
  return () => exitListeners.delete(fn);
}

// module-scope and permanent by design: these feed terminals that outlive
// any one mount, so the disposers are deliberately dropped
export function ensureSubscribed(): void {
  if (subscribed) return;
  subscribed = true;
  // a session starts writing before its tab is first shown, so its terminal
  // is made on its first output rather than on first attach
  window.jarvis.onPtyData((id, data) => entryFor(id).term.write(data));
  window.jarvis.onPtyExit((id, code) => {
    for (const l of exitListeners) l(id, code);
    // A numbered session's tab goes away with it, and a later session may
    // reuse its key. A main key has no `#` and keeps its scrollback behind
    // the launch overlay.
    if (id.includes("#")) disposeTerminal(id);
  });
}

export function entryFor(id: string): Entry {
  let e = entries.get(id);
  if (!e) {
    const term = new Terminal({
      fontSize: 13,
      fontFamily: "Consolas, monospace",
      theme: { background: "#02060b" },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    const el = document.createElement("div");
    el.style.width = "100%";
    el.style.height = "100%";
    term.open(el);
    term.onData((d) => {
      window.jarvis.ptyInput(id, d);
      // arrow keys move through a question without answering it; a bare Esc
      // dismisses it, so that one counts as typing
      if (d === "\x1b" || !d.startsWith("\x1b"))
        for (const l of typedListeners) l(id);
    });
    e = { term, fit, el };
    entries.set(id, e);
  }
  return e;
}

function drop(key: string): void {
  entries.get(key)?.term.dispose();
  entries.delete(key);
  doomed.delete(key);
}

/** Frees an ended session's terminal, so a later session reusing its key
 *  starts on an empty screen. One still on screen is freed when the panel
 *  detaches it (`releaseDetached`), since its resize observer still fits it. */
export function disposeTerminal(key: string): void {
  const e = entries.get(key);
  if (!e) return;
  if (e.el.isConnected) doomed.add(key);
  else drop(key);
}

/** Called by the panel after it detaches a terminal. */
export function releaseDetached(key: string): void {
  if (doomed.has(key)) drop(key);
}

/** The size a new session should start at: that of the terminal on screen. */
export function terminalSize(key: string): { cols: number; rows: number } {
  const e = entries.get(key);
  return e ? { cols: e.term.cols, rows: e.term.rows } : { cols: 80, rows: 24 };
}
