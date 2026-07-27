// The one bit of real logic on the reply path: never send an empty line, and
// terminate the reply with a carriage return so the session submits it. Uses
// the same ptyInput pipe TerminalPanel uses for keystrokes — no new IPC.
//
// The CR is a second, later write: Claude Code's TUI reads one arriving chunk
// as a paste, so a trailing "\r" lands as a newline in the composer instead of
// submitting. Same split orchestrate.send uses.
// ponytail: fixed 80ms, not a prompt-ready probe — bump if a busy TUI misses it
export function sendReply(workspaceId: string, text: string): boolean {
  if (!text.trim()) return false;
  window.jarvis.ptyInput(workspaceId, text);
  setTimeout(() => window.jarvis.ptyInput(workspaceId, "\r"), 80);
  return true;
}
