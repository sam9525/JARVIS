import type { RawHookEvent } from "../event-mapper";
import type { AgentId, StatusKind } from "../../shared/types";
import { notificationPayload } from "./antigravity-notify";
import { createOscScanner } from "./osc-notify";

const ESC = "\x1b";

/** Reads an Antigravity session's terminal: its notification codes become
 * hook Notifications, and the turn ends agy reports with no hook are noted on
 * the ready gate. Sessions of every other agent are left alone. */
export function createAntigravityTerminal(deps: {
  agentOf(id: string): AgentId | undefined;
  cwdOf(id: string): string | undefined;
  sessionIdOf(id: string): string;
  statusKindOf(id: string): StatusKind | undefined;
  noteGate(id: string, hookEventName: string): void;
  map(payload: RawHookEvent): void;
}): {
  output(id: string, data: string): void;
  keyed(id: string, data: string, keyed: boolean): void;
  forget(id: string): void;
} {
  const scanner = createOscScanner();
  const isAntigravity = (id: string) => deps.agentOf(id) === "antigravity";

  return {
    output(id, data) {
      if (!isAntigravity(id)) return;
      const cwd = deps.cwdOf(id);
      for (const text of scanner.feed(id, data)) {
        if (!cwd) continue;
        const payload = notificationPayload(text, {
          key: id,
          cwd,
          // a code before the first hook maps nothing: the session has no id yet
          sessionId: deps.sessionIdOf(id),
        });
        if (!payload) continue;
        if (payload.notification_type === "idle_prompt") {
          // Tool output printed under an open permission prompt can carry the
          // ready code; a send it unlocked would answer "1. Yes". Esc ends
          // blocked through promptKeyed instead.
          if (deps.statusKindOf(id) === "blocked") continue;
          // Esc in the middle of a turn sends "ready for input" with no Stop
          deps.noteGate(id, "Interrupt");
        }
        deps.map(payload);
      }
    },

    // Esc at any prompt promptKeyed ends (asking or blocked) sends no hook and
    // no code, so the key that closed the prompt also ends the gate's turn
    keyed(id, data, keyed) {
      if (keyed && data === ESC && isAntigravity(id))
        deps.noteGate(id, "Interrupt");
    },

    forget(id) {
      scanner.forget(id);
    },
  };
}
