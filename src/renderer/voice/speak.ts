import type { WorkspaceStatus } from "../../shared/types";
import { WAKE_WORD } from "./wake";

// built per call rather than hoisted: WAKE_WORD is interpolated, and a shared
// instance is one flag change away from carrying lastIndex between calls.
const wakeRe = () => new RegExp(`\\b${WAKE_WORD}\\b`, "i");

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
  // Claude's own text can plausibly contain "jarvis" — echoCancellation
  // reduces but does not eliminate speaker bleed, and speaking it aloud risks
  // the mic hearing its own wake word and opening a dictation on nothing.
  if (wakeRe().test(message)) return null;
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
  if (!synth || !Utterance) return; // half a mouth is not a mouth
  // a backlog of stale statuses read in order is worse than the newest one
  synth.cancel();
  synth.speak(new Utterance(text));
}

// Same feature-detect as speak(): the mic-off transition must not assume a
// mouth exists to silence.
export function stopSpeaking(): void {
  const synth = (globalThis as { speechSynthesis?: SpeechSynthesis })
    .speechSynthesis;
  synth?.cancel();
}
