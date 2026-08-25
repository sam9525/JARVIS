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

// Whichever mouth is talking, only one is. Module level because a new
// utterance must be able to stop the previous one — a backlog read in order is
// worse than the newest line.
let current: HTMLAudioElement | null = null;

// Bumped by stopSpeaking() and compared after every await in speak(), so a
// call whose IPC round-trip outlives a stop or a newer speak() call notices
// and backs off instead of playing over — or after — whatever superseded it.
let generation = 0;

// speechSynthesis is missing in jsdom and can be missing in a stripped
// Electron build. A missing mouth must not break dictation, so this is a
// feature detect rather than a throw. Both callers reach this only after
// speak() has already run stopSpeaking(), so no cancel is needed here.
function localSpeak(text: string): void {
  const synth = (globalThis as { speechSynthesis?: SpeechSynthesis })
    .speechSynthesis;
  const Utterance = (
    globalThis as { SpeechSynthesisUtterance?: typeof SpeechSynthesisUtterance }
  ).SpeechSynthesisUtterance;
  if (!synth || !Utterance) return; // half a mouth is not a mouth
  synth.speak(new Utterance(text));
}

/** Cloud voice first; speechSynthesis whenever main hands back nothing — no
 * key, a revoked key, a spent quota and a timeout are one case here. */
export async function speak(text: string): Promise<void> {
  stopSpeaking();
  const myGeneration = generation; // captured after the bump above, so this call isn't its own stale call
  let bytes: Uint8Array | null = null;
  try {
    bytes = (await window.jarvis?.ttsSpeak?.(text)) ?? null;
  } catch {
    bytes = null; // main unreachable — the local mouth still works
  }
  if (myGeneration !== generation) return; // stopped or superseded while awaiting — the bytes arrived too late to matter
  if (!bytes) {
    localSpeak(text);
    return;
  }
  const url = URL.createObjectURL(new Blob([bytes], { type: "audio/mpeg" }));
  const audio = new Audio(url);
  current = audio;
  audio.onended = () => {
    URL.revokeObjectURL(url);
    if (current === audio) current = null;
  };
  await audio.play().catch((err) => {
    if (current !== audio) return; // already stopped or superseded — stale text must not speak
    // the OS voice that follows sounds the same whether main handed back no
    // bytes or the bytes would not play, and only main logs the first case
    console.warn("[tts] play rejected:", err);
    URL.revokeObjectURL(url);
    current = null;
    localSpeak(text);
  });
}

/** True while either mouth is producing sound. The ear reads this and drops
 * what it hears: the app must not transcribe its own voice, and a summary
 * naming a workspace called JARVIS would otherwise speak the wake word. */
export function isSpeaking(): boolean {
  // `ended`/`paused` rather than `current !== null` alone: an utterance whose
  // `onended` never fires would otherwise leave the ear deaf for the rest of
  // the session, and a microphone that stops working is worse than an echo.
  const cloud = current !== null && !current.ended && !current.paused;
  return (
    cloud ||
    (globalThis as { speechSynthesis?: SpeechSynthesis }).speechSynthesis
      ?.speaking === true
  );
}

// Either mouth may be the one talking, so the mic-off transition silences
// both. An interrupted cloud utterance never reaches its own `onended`, so
// its blob URL is revoked here instead — otherwise every interruption leaks
// one.
export function stopSpeaking(): void {
  generation++; // invalidates any speak() still awaiting its IPC round-trip
  if (current) {
    current.pause();
    URL.revokeObjectURL(current.src);
    current = null;
  }
  (
    globalThis as { speechSynthesis?: SpeechSynthesis }
  ).speechSynthesis?.cancel();
}
