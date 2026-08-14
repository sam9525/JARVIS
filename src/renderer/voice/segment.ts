// Pure voice-activity segmentation: audio blocks in, whole utterances out.
// Split from voice-tracker.ts so every timing rule here is unit-testable
// without a microphone — the tracker keeps only getUserMedia, AudioContext
// and the whisper pipeline, which cannot be.
//
// The alternative was transcribing a rolling window. That runs whisper every
// second forever, which is the spec's main stated risk; gating on energy
// costs one RMS per block while the room is quiet.
export const SAMPLE_RATE = 16000; // whisper's rate; resampling is the browser's job
export const RMS_ON = 0.02; // speech starts
export const RMS_OFF = 0.01; // and ends — hysteresis, so a pause mid-word holds
export const HANG_MS = 700; // this much quiet ends the utterance
export const MIN_MS = 300; // shorter is a cough, not speech
export const MAX_MS = 15000; // hard cap: a noisy room must not grow it forever

export function rms(block: Float32Array): number {
  let sum = 0;
  for (const s of block) sum += s * s;
  return Math.sqrt(sum / block.length);
}

export function join(parts: Float32Array[]): Float32Array {
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

export class Segmenter {
  speaking = false;
  private parts: Float32Array[] = [];
  private quietMs = 0;
  private heldMs = 0;

  constructor(private readonly sampleRate: number = SAMPLE_RATE) {}

  /**
   * Fold one audio block in. Returns the finished utterance when this block
   * ended one, and null otherwise — including when the utterance ended but
   * was too short to be a command. Read `speaking` for the boundary.
   *
   * The caller owns the copy: Web Audio reuses its buffer between callbacks,
   * so pass a fresh Float32Array.
   */
  push(block: Float32Array): Float32Array | null {
    const blockMs = (block.length / this.sampleRate) * 1000;
    const level = rms(block);
    if (!this.speaking) {
      if (level < RMS_ON) return null;
      this.speaking = true;
      this.quietMs = 0;
      this.heldMs = 0;
    }
    this.parts.push(block);
    this.heldMs += blockMs;
    // measured against the lower threshold, not RMS_ON: a sentence dips
    // between words, and ending there would cut every command in half
    this.quietMs = level < RMS_OFF ? this.quietMs + blockMs : 0;
    if (this.quietMs < HANG_MS && this.heldMs < MAX_MS) return null;
    return this.end();
  }

  private end(): Float32Array | null {
    const { parts, heldMs, quietMs } = this;
    this.parts = [];
    this.speaking = false;
    this.quietMs = 0;
    this.heldMs = 0;
    // MIN_MS measures speech, not held audio: the trailing quiet that closed
    // the segment is in `parts` too, and counting it would let a single click
    // plus its own hang time pass as a command
    return heldMs - quietMs >= MIN_MS ? join(parts) : null;
  }
}
