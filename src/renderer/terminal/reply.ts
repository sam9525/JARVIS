// The one bit of real logic on the reply path: never send an empty line, and
// terminate the reply with a carriage return so the session submits it. Uses
// the same ptyInput pipe TerminalPanel uses for keystrokes — no new IPC.
export function sendReply(workspaceId: string, text: string): boolean {
  if (!text.trim()) return false;
  window.jarvis.ptyInput(workspaceId, text + "\r");
  return true;
}
