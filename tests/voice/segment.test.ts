import { describe, it, expect } from "vitest";
import {
  Segmenter,
  rms,
  join,
  SAMPLE_RATE,
  HANG_MS,
} from "../../src/renderer/voice/segment";

// 1600 samples at 16 kHz is exactly 100 ms. A constant-amplitude block has an
// RMS equal to that amplitude, which makes every threshold below readable.
const MS = 100;
const N = (SAMPLE_RATE * MS) / 1000;
const block = (amplitude: number) => new Float32Array(N).fill(amplitude);
const LOUD = block(0.1); // well above RMS_ON
const QUIET = block(0.001); // well below RMS_OFF
const HANG_BLOCKS = Math.ceil(HANG_MS / MS);

describe("rms", () => {
  it("is the amplitude of a constant block", () => {
    expect(rms(block(0.5))).toBeCloseTo(0.5, 6);
  });

  it("is zero for silence", () => {
    expect(rms(block(0))).toBe(0);
  });
});

describe("join", () => {
  it("concatenates in order", () => {
    const out = join([Float32Array.from([1, 2]), Float32Array.from([3])]);
    expect(Array.from(out)).toEqual([1, 2, 3]);
  });

  it("is empty for no parts", () => {
    expect(join([])).toHaveLength(0);
  });
});

describe("Segmenter", () => {
  it("never starts on silence", () => {
    const s = new Segmenter();
    for (let i = 0; i < 50; i++) expect(s.push(QUIET)).toBe(null);
    expect(s.speaking).toBe(false);
  });

  it("starts speaking on a loud block", () => {
    const s = new Segmenter();
    expect(s.push(LOUD)).toBe(null);
    expect(s.speaking).toBe(true);
  });

  it("ends after HANG_MS of quiet and returns the held audio", () => {
    const s = new Segmenter();
    for (let i = 0; i < 10; i++) s.push(LOUD); // 1000 ms of speech
    let out: Float32Array | null = null;
    for (let i = 0; i < HANG_BLOCKS; i++) out = s.push(QUIET);
    expect(out).not.toBe(null);
    expect(s.speaking).toBe(false);
    // 10 loud blocks + the quiet tail that closed it
    expect(out!.length).toBe((10 + HANG_BLOCKS) * N);
  });

  it("a short pause mid-sentence does not end it", () => {
    const s = new Segmenter();
    for (let i = 0; i < 5; i++) s.push(LOUD);
    for (let i = 0; i < HANG_BLOCKS - 1; i++) expect(s.push(QUIET)).toBe(null);
    expect(s.speaking).toBe(true);
    expect(s.push(LOUD)).toBe(null); // speech resumes, the clock resets
    for (let i = 0; i < HANG_BLOCKS - 1; i++) expect(s.push(QUIET)).toBe(null);
    expect(s.speaking).toBe(true);
  });

  it("discards a blip too short to be a command", () => {
    const s = new Segmenter();
    s.push(LOUD); // 100 ms, below MIN_MS
    let out: Float32Array | null = null;
    for (let i = 0; i < HANG_BLOCKS; i++) out = s.push(QUIET);
    expect(out).toBe(null);
    expect(s.speaking).toBe(false);
  });

  it("caps a segment at MAX_MS so a noisy room cannot grow it forever", () => {
    const s = new Segmenter();
    let out: Float32Array | null = null;
    for (let i = 0; i < 1000 && out === null; i++) out = s.push(LOUD);
    expect(out).not.toBe(null);
    expect(out!.length / SAMPLE_RATE).toBeLessThanOrEqual(16);
  });

  it("is reusable: a second utterance starts clean", () => {
    const s = new Segmenter();
    for (let i = 0; i < 10; i++) s.push(LOUD);
    for (let i = 0; i < HANG_BLOCKS; i++) s.push(QUIET);
    for (let i = 0; i < 10; i++) s.push(LOUD);
    let out: Float32Array | null = null;
    for (let i = 0; i < HANG_BLOCKS; i++) out = s.push(QUIET);
    expect(out!.length).toBe((10 + HANG_BLOCKS) * N);
  });
});
