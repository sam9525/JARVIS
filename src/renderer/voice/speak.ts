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

/** How long the ear stays deaf after the last sound. The segmenter only ends
 * an utterance HANG_MS after the room goes quiet and whisper runs after that,
 * so a segment recorded while the app was talking arrives with the mouth
 * already silent — `isSounding()` alone reads false exactly when it matters.
 * ponytail: fixed tail, sized for HANG_MS plus one transcription; measure the
 * transcribe time and derive it if whisper ever gets slow enough to outrun it. */
export const DEAF_TAIL_MS = 2000;

let deafUntil = 0;

const stoppedSounding = () => {
  deafUntil = Date.now() + DEAF_TAIL_MS;
};

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
  const utterance = new Utterance(text);
  utterance.onend = stoppedSounding;
  synth.speak(utterance);
}

// `ended`/`paused` rather than `current !== null` alone: an utterance whose
// `onended` never fires would otherwise leave the ear deaf for the rest of the
// session, and a microphone that stops working is worse than an echo.
const cloudSounding = (): boolean =>
  current !== null && !current.ended && !current.paused;

/** Samples per waveform read. 256 is the smallest fftSize that still draws a
 * recognisable wave at the ~180px the bezel gives it. */
export const WAVE_BINS = 256;

// One graph for every utterance. A context per Audio element would open one
// per summary, and browsers cap how many a page may hold.
let audioCtx: AudioContext | null = null;
let analyser: AnalyserNode | null = null;
let sourceNode: MediaElementAudioSourceNode | null = null;

// Routing an element through a MediaElementSource takes its sound OUT of the
// element — without the connect to destination below, wiring the analyser
// would mute the voice. Every failure here leaves the element unrouted and
// still audible, with the wave flat: the sound matters more than the picture.
function wireAnalyser(audio: HTMLAudioElement): void {
  const Ctor = (globalThis as { AudioContext?: typeof AudioContext })
    .AudioContext;
  if (!Ctor) return; // jsdom, and any build without Web Audio
  try {
    if (!audioCtx) audioCtx = new Ctor();
    // A suspended context passes no sound, so routing the element into one
    // would mute the voice outright — worse than having no wave. Ask it to
    // resume and leave this utterance unrouted; the next one gets the wave.
    // Checked before the analyser is built, so readWave has nothing to read
    // and the wave reports itself flat rather than drawing a dead signal.
    if (audioCtx.state !== "running") {
      void audioCtx.resume();
      return;
    }
    if (!analyser) {
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = WAVE_BINS;
      analyser.smoothingTimeConstant = 0.7;
      analyser.connect(audioCtx.destination);
    }
    sourceNode?.disconnect(); // the previous utterance is done with it
    sourceNode = audioCtx.createMediaElementSource(audio);
    sourceNode.connect(analyser);
  } catch {
    // no analyser this time; the element plays unrouted and the wave stays flat
  }
}

/** Fills `out` with the current waveform — bytes 0..255 centred on 128 — and
 * returns whether it is live. False means draw a flat line, which covers both
 * silence and the local mouth: speechSynthesis writes straight to the output
 * device, and no Web Audio node can see it. */
export function readWave(out: Uint8Array): boolean {
  if (!analyser || !cloudSounding()) return false;
  analyser.getByteTimeDomainData(out);
  return true;
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
  wireAnalyser(audio);
  audio.onended = () => {
    URL.revokeObjectURL(url);
    if (current === audio) current = null;
    stoppedSounding();
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

/** True while either mouth is producing sound right now. The head reads this
 * — not `isSpeaking()`, which stays true through the deaf tail and would leave
 * the mouth moving for two seconds after the last word. */
export function isSounding(): boolean {
  return (
    cloudSounding() ||
    (globalThis as { speechSynthesis?: SpeechSynthesis }).speechSynthesis
      ?.speaking === true
  );
}

/** True while either mouth is talking and for DEAF_TAIL_MS after it stops.
 * The ear reads this and drops what it hears: the app must not transcribe its
 * own voice, and a summary naming a workspace called JARVIS says the wake word
 * out loud. The tail is the half that catches the echo — by the time the app's
 * own words come back as text, the mouth has already closed. */
export function isSpeaking(): boolean {
  return isSounding() || Date.now() < deafUntil;
}

// Either mouth may be the one talking, so the mic-off transition silences
// both. An interrupted cloud utterance never reaches its own `onended`, so
// its blob URL is revoked here instead — otherwise every interruption leaks
// one.
export function stopSpeaking(): void {
  generation++; // invalidates any speak() still awaiting its IPC round-trip
  // an interruption is still a mouth that was open a moment ago, so the echo
  // of what it already said is still on its way through the segmenter
  if (isSounding()) stoppedSounding();
  if (current) {
    current.pause();
    URL.revokeObjectURL(current.src);
    current = null;
    // the node was built from this element; it has nothing left to carry
    sourceNode?.disconnect();
    sourceNode = null;
  }
  (
    globalThis as { speechSynthesis?: SpeechSynthesis }
  ).speechSynthesis?.cancel();
}
