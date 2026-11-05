import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { clearDraft, getDraft, onDraft } from "../session-screen/drafts";
import { clearViewMode } from "../session-screen/view-mode";
import { markTerminalTyped } from "./typed-signal";

export { onTerminalTyped } from "./typed-signal";

export type Entry = { term: Terminal; fit: FitAddon; el: HTMLDivElement };

// Module-level and keyed by session key, so terminals (and their scrollback)
// survive tab and workspace switches and panel collapse/expand — the panel
// only attaches them.
const entries = new Map<string, Entry>();
// keys whose terminal is freed as soon as the panel detaches it
const doomed = new Set<string>();
const exitListeners = new Set<(id: string, code: number) => void>();
let subscribed = false;

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
    // A numbered session's tab goes away with a clean exit, and a later
    // session may reuse its key. A crashed one keeps its tab, and with it the
    // output that says why, until the user closes it. A main key has no `#`
    // and keeps its scrollback behind the launch overlay.
    if (id.includes("#") && code === 0) disposeTerminal(id);
  });
  // main refuses to auto-close a session whose draft it knows about
  const drafted = new Set<string>();
  onDraft((key) => {
    const has = getDraft(key) !== "";
    if (has === drafted.has(key)) return;
    if (has) drafted.add(key);
    else drafted.delete(key);
    window.jarvis.draftState(key, has);
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
      if (d === "\x1b" || !d.startsWith("\x1b")) markTerminalTyped(id);
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

/** Frees an ended session's terminal, draft and view mode, so a later session
 *  reusing its key starts empty. A terminal still on screen is freed when the
 *  panel detaches it (`releaseDetached`), since its resize observer still fits it. */
export function disposeTerminal(key: string): void {
  clearDraft(key);
  clearViewMode(key);
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
