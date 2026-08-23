// Pure voice-activity segmentation: audio blocks in, whole utterances out.
// Split from voice-tracker.ts so every timing rule here is unit-testable
// without a microphone — the tracker keeps only getUserMedia, AudioContext
// and the whisper pipeline, which cannot be.
//
// Gating on energy costs one RMS per block while the room is quiet.
// Transcribing a rolling window instead runs whisper every second forever,
// which is the spec's main stated risk.
export const SAMPLE_RATE = 16000; // whisper's rate; resampling is the browser's job
// Floors, not fixed thresholds. A microphone sits on a noise floor of its
// own, often around 0.01 — level with RMS_OFF, where no block ever counts as
// quiet and no utterance ever ends. The live thresholds scale off the
// measured floor (below) and never drop under these.
export const RMS_ON = 0.02; // speech starts
export const RMS_OFF = 0.01; // and ends — hysteresis, so a pause mid-word holds
// Multiples of the noise floor. 3x is clearly a voice; 1.8x still is, which
// is what keeps a dip between two words from ending the sentence.
export const ON_OVER_FLOOR = 3;
export const OFF_OVER_FLOOR = 1.8;
// How fast the floor may rise, per block. Falling is instant — a room that
// went quiet is quiet now — but rising slowly is what stops a long sentence
// from being read as the new floor and gating out the rest of itself.
export const FLOOR_RISE = 0.02;
export const HANG_MS = 700; // this much quiet ends the utterance
export const MIN_MS = 300; // shorter is a cough, not speech
export const MAX_MS = 15000; // hard cap: a noisy room must not grow it forever
// Audio kept from before the trigger. A word's first consonant (s, f, t, k)
// carries little energy, so RMS crosses RMS_ON part-way into the first word
// and whisper is handed a fragment — which it completes by guessing.
export const PRE_MS = 300;

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
  /** RMS of the block last passed to `push`, so a caller reading the level
   * does not run a second pass over the same samples. */
  level = 0;
  /** Measured room noise, tracked only while not speaking. */
  floor = 0;
  private parts: Float32Array[] = [];
  private quietMs = 0;
  private heldMs = 0;
  // rolling PRE_MS of quiet, prepended to the next utterance
  private pre: Float32Array[] = [];
  private preMs = 0;

  constructor(private readonly sampleRate: number = SAMPLE_RATE) {}

  /**
   * Fold one audio block in. Returns the finished utterance when this block
   * ended one, and null otherwise — including when the utterance ended but
   * was too short to be a command. Read `speaking` for the boundary.
   *
   * The caller owns the copy: Web Audio reuses its buffer between callbacks,
   * so pass a fresh Float32Array.
   */
  /** The live start threshold: the higher of the fixed floor and a multiple
   * of the measured room noise. */
  get on(): number {
    return Math.max(RMS_ON, this.floor * ON_OVER_FLOOR);
  }

  /** The live end threshold. See `on`. */
  get off(): number {
    return Math.max(RMS_OFF, this.floor * OFF_OVER_FLOOR);
  }

  push(block: Float32Array): Float32Array | null {
    const blockMs = (block.length / this.sampleRate) * 1000;
    const level = (this.level = rms(block));
    if (!this.speaking) {
      this.floor =
        level < this.floor
          ? level
          : this.floor + (level - this.floor) * FLOOR_RISE;
      if (level < this.on) {
        this.pre.push(block);
        this.preMs += blockMs;
        while (this.preMs > PRE_MS && this.pre.length > 1) {
          const [dropped] = this.pre.splice(0, 1);
          this.preMs -= (dropped.length / this.sampleRate) * 1000;
        }
        return null;
      }
      this.speaking = true;
      this.quietMs = 0;
      // the pre-roll is quiet by definition, so it seeds `parts` but not
      // `heldMs` — counting it would let a click pass the MIN_MS floor
      this.heldMs = 0;
      this.parts = this.pre;
      this.pre = [];
      this.preMs = 0;
    }
    this.parts.push(block);
    this.heldMs += blockMs;
    // measured against the lower threshold, not RMS_ON: a sentence dips
    // between words, and ending there would cut every command in half
    this.quietMs = level < this.off ? this.quietMs + blockMs : 0;
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

// No gain stage on purpose. Whisper's feature extraction is level-blind — one
// recording at 1x, 0.3x, 0.1x and 0.03x transcribes identically — so the level
// the segmenter captures is the level whisper works with.
