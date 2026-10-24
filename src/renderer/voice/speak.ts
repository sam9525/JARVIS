import type { WorkspaceStatus } from "../../shared/types";

/** Longest summary the mouth reads — the same cap `jarvis_say` carries. */
export const SUMMARY_MAX = 500;

// a stop after e.g / i.e / etc / vs is an abbreviation, not a sentence end
const sentences = (paragraph: string): string[] =>
  (
    paragraph.match(
      /[\s\S]*?(?<!\b(?:e\.g|i\.e|etc|vs))[.!?](?=\s|$)|[\s\S]+$/g,
    ) ?? []
  )
    .map((s) => s.trim())
    .filter(Boolean);

// headings, bullets and emphasis marks are read aloud literally otherwise
const plain = (text: string): string =>
  text
    .replace(/^[ \t]*(?:#{1,6}|[-*+]|\d+[.)])[ \t]+/gm, "")
    .replace(/\*\*|__|`/g, "");

/** The spoken form of a message: one paragraph whole, several as the lead
 * sentence of each, joined and cut at the last sentence under `SUMMARY_MAX`.
 * A five-project briefing read aloud in full is a minute of speech that cannot
 * be skipped, and the cloud mouth bills per character, so the body is skipped
 * but every paragraph still gets its point said. The inbox and the cards
 * render `message` whole.
 * ponytail: extractive, the app runs no model — only as good as the agent's
 * lead sentences. */
export const spokenSummary = (text: string): string => {
  const paragraphs = plain(text)
    .trim()
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  const said =
    paragraphs.length <= 1
      ? sentences(paragraphs[0] ?? "")
      : paragraphs.map((p) => sentences(p)[0] ?? p);
  let summary = "";
  for (const sentence of said) {
    const next = summary ? `${summary} ${sentence}` : sentence;
    if (next.length > SUMMARY_MAX) {
      return summary || sentence.slice(0, SUMMARY_MAX);
    }
    summary = next;
  }
  return summary;
};

/** What the mouth last covered. `at` is the `messageAt` of the turn it
 * covered, or null for a jarvis_say line whose turn has not ended yet. */
export interface Spoken {
  text: string;
  at: number | null;
}

// The app never parses terminal output, so `message` — the hook-derived text
// workspace-status already pushes — is the only thing there is to read aloud.
// Only the orchestrator's row reaches here; the caller picks it.
//
// A turn is known by its stamp, not its words: the same reply twice is two
// answers. A jarvis_say line has no turn yet, so its turn-end copy is known
// by its words — summarised on both sides, since the line is stored whole.
export function nextUtterance(
  status: WorkspaceStatus | undefined,
  spoken: Spoken,
  capturing: boolean,
): string | null {
  if (capturing) return null; // never talk over an open dictation
  const message = spokenSummary(status?.message ?? "");
  if (!message) return null;
  const repeat =
    spoken.at === null
      ? message === spokenSummary(spoken.text)
      : status?.messageAt === spoken.at;
  return repeat ? null : message;
}

// Whichever mouth is talking, only one is: lines play in call order, each
// after the one before it has ended. Module level because stopSpeaking() must
// reach the element that is playing.
let current: HTMLAudioElement | null = null;

// Marks the backlog a stopSpeaking() dropped. Each speak() captures it at call
// time and compares after every await, so a line queued or awaiting its IPC
// round-trip before a stop notices and backs off instead of playing after it.
let generation = 0;

/** Longest one line may hold the queue. A cloud `onended` that never fires
 * would otherwise silence every line behind it for the rest of the session. */
// Sits above the worst fetch (tts.ts AbortSignal.timeout(8000) plus the
// edge-tts 8000 ms race, about 16 s) plus a SUMMARY_MAX line (about 35 s);
// raise it with those timeouts.
export const TURN_CAP_MS = 60_000;

// Tail of the line chain; each speak() appends one turn to it.
let queue: Promise<void> = Promise.resolve();

// Ends the turn now playing. Only stopSpeaking() calls it: every other end
// goes through that turn's own `finish`, so a late `onended` from a stopped
// line cannot end the line after it.
let endTurn: (() => void) | null = null;

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
// feature detect rather than a throw, and it ends the turn at once.
function localSpeak(text: string, onDone: () => void): void {
  const synth = (globalThis as { speechSynthesis?: SpeechSynthesis })
    .speechSynthesis;
  const Utterance = (
    globalThis as { SpeechSynthesisUtterance?: typeof SpeechSynthesisUtterance }
  ).SpeechSynthesisUtterance;
  if (!synth || !Utterance) {
    onDone(); // half a mouth is not a mouth
    return;
  }
  const utterance = new Utterance(text);
  // onerror too: a failed utterance never fires onend and would hold the queue
  const end = () => {
    stoppedSounding();
    onDone();
  };
  utterance.onend = end;
  utterance.onerror = end;
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
export function readWave(out: Uint8Array<ArrayBuffer>): boolean {
  if (!analyser || !cloudSounding()) return false;
  analyser.getByteTimeDomainData(out);
  return true;
}

// One line's turn: fetch, start the mouth, hold the queue until it ends.
// `started` settles speak()'s promise as soon as the line is sounding.
async function sayOne(
  text: string,
  myGeneration: number,
  started: () => void,
): Promise<void> {
  if (myGeneration !== generation) return; // dropped by a stopSpeaking() while queued
  let release!: () => void;
  const ended = new Promise<void>((resolve) => {
    release = resolve;
  });
  const finish = () => {
    clearTimeout(timer);
    if (endTurn === finish) endTurn = null;
    release();
  };
  endTurn = finish;
  // the backlog continues after a cap, so the generation is not bumped
  const timer = setTimeout(() => {
    silenceMouths();
    finish();
  }, TURN_CAP_MS);

  // a throw below must not leave the cap armed against a later line
  try {
    let bytes: Uint8Array<ArrayBuffer> | null = null;
    try {
      bytes = (await window.jarvis?.ttsSpeak?.(text)) ?? null;
    } catch {
      bytes = null; // main unreachable — the local mouth still works
    }
    if (myGeneration !== generation) {
      finish(); // stopped while awaiting — the bytes arrived too late to matter
      return;
    }
    if (!bytes) {
      localSpeak(text, finish);
      started();
      await ended;
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
      finish();
    };
    await audio.play().catch((err) => {
      if (current !== audio) return; // already stopped or capped — stale text must not speak
      // the OS voice that follows sounds the same whether main handed back no
      // bytes or the bytes would not play, and only main logs the first case
      console.warn("[tts] play rejected:", err);
      URL.revokeObjectURL(url);
      current = null;
      localSpeak(text, finish);
    });
    started();
    await ended;
  } finally {
    finish();
  }
}

/** Cloud voice first; speechSynthesis whenever main hands back nothing — no
 * key, a revoked key, a spent quota and a timeout are one case here. Lines
 * play in call order; the promise settles once this line is sounding (or was
 * skipped or dropped), not when it ends. */
export function speak(text: string): Promise<void> {
  const myGeneration = generation;
  return new Promise<void>((resolve) => {
    queue = queue
      .then(() => sayOne(text, myGeneration, resolve))
      .catch(() => undefined) // one failed line must not break the chain
      .finally(resolve);
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

/** True while either mouth is talking, while a queued line's turn is in flight
 * (its fetch can outlast the tail), and for DEAF_TAIL_MS after it stops.
 * The ear reads this and drops what it hears: the app must not transcribe its
 * own voice, and a summary naming a workspace called JARVIS says the wake word
 * out loud. The tail is the half that catches the echo — by the time the app's
 * own words come back as text, the mouth has already closed. */
export function isSpeaking(): boolean {
  return isSounding() || endTurn !== null || Date.now() < deafUntil;
}

// Either mouth may be the one talking, so both are silenced. An interrupted
// cloud utterance never reaches its own `onended`, so its blob URL is revoked
// here instead — otherwise every interruption leaks one.
function silenceMouths(): void {
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

/** Silences the mouth and drops every line still queued or fetching. */
export function stopSpeaking(): void {
  generation++;
  silenceMouths();
  endTurn?.();
}

/**
 * How far the mouth is open for the waveform in `buf`, as 0..1.
 *
 * RMS, not the loudest sample: a single plosive spikes the peak, and the jaw
 * then snaps on one frame of one consonant. RMS is also what loudness sounds
 * like, so the opening tracks the syllable rather than its hardest edge.
 *
 * The knee is an exponential rather than the wave's `Math.min(x * GAIN, 1)`:
 * clipping pins the jaw wide open across a whole loud phrase, and a mouth that
 * cannot vary between loud syllables reads as flapping instead of speaking.
 * The curve is monotone, so every syllable still differs from the next.
 *
 * ponytail: one fixed knee, sized so a normal TTS line uses most of the
 * travel; make it a running normaliser if a voice ever sits shut or gapes.
 */
export const MOUTH_KNEE = 10;

export function mouthOpen(buf: Uint8Array): number {
  if (!buf.length) return 0;
  let sum = 0;
  for (let i = 0; i < buf.length; i++) {
    const d = (buf[i] - 128) / 128;
    sum += d * d;
  }
  return 1 - Math.exp(-MOUTH_KNEE * Math.sqrt(sum / buf.length));
}
