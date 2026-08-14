import type { WorkspaceStatus } from "../../shared/types";

// The app never parses terminal output, so `message` — the hook-derived text
// workspace-status already pushes — is the only thing there is to read aloud.
// Only the orchestrator's row reaches here; the caller picks it.
export function nextUtterance(
  status: WorkspaceStatus | undefined,
  spoken: string,
  capturing: boolean,
): string | null {
  if (capturing) return null; // never talk over an open dictation
  const message = status?.message?.trim() ?? "";
  if (!message || message === spoken.trim()) return null;
  return message;
}

// speechSynthesis is missing in jsdom and can be missing in a stripped
// Electron build. A missing mouth must not break dictation, so this is a
// feature detect rather than a throw.
export function speak(text: string): void {
  const synth = (globalThis as { speechSynthesis?: SpeechSynthesis })
    .speechSynthesis;
  const Utterance = (
    globalThis as { SpeechSynthesisUtterance?: typeof SpeechSynthesisUtterance }
  ).SpeechSynthesisUtterance;
  if (!synth) return;
  // a backlog of stale statuses read in order is worse than the newest one
  synth.cancel();
  synth.speak(Utterance ? new Utterance(text) : ({ text } as never));
}
