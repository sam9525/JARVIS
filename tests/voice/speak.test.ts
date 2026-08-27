// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import {
  DEAF_TAIL_MS,
  isSounding,
  isSpeaking,
  nextUtterance,
  readWave,
  speak,
  stopSpeaking,
  WAVE_BINS,
} from "../../src/renderer/voice/speak";
import type { WorkspaceStatus } from "../../src/shared/types";

const status = (message: string): WorkspaceStatus =>
  ({ workspaceId: "w1", kind: "idle", message }) as WorkspaceStatus;

describe("nextUtterance", () => {
  it("is null with no status row", () => {
    expect(nextUtterance(undefined, "", false)).toBe(null);
  });

  it("is null when the message is empty", () => {
    expect(nextUtterance(status("   "), "", false)).toBe(null);
  });

  it("returns a new message", () => {
    expect(nextUtterance(status("build is green"), "", false)).toBe(
      "build is green",
    );
  });

  it("never repeats the message it already spoke", () => {
    expect(
      nextUtterance(status("build is green"), "build is green", false),
    ).toBe(null);
  });

  it("stays silent while capturing, so it never talks over you", () => {
    expect(nextUtterance(status("build is green"), "", true)).toBe(null);
  });

  it("trims, so a trailing newline does not defeat the repeat check", () => {
    expect(nextUtterance(status("done\n"), "done", false)).toBe(null);
  });

  // The mouth used to refuse any message containing the wake word. With a
  // workspace named JARVIS every summary names it, so that guard silenced the
  // commonest line there is. The ear goes deaf while the mouth talks instead.
  it("speaks a message containing the wake word", () => {
    expect(nextUtterance(status("Jarvis, build is green"), "", false)).toBe(
      "Jarvis, build is green",
    );
  });
});

describe("speak", () => {
  afterEach(() => {
    delete (globalThis as { speechSynthesis?: unknown }).speechSynthesis;
  });

  it("does nothing when the platform has no speech synthesis", async () => {
    await expect(speak("hello")).resolves.toBeUndefined();
  });

  it("cancels queued speech first, so stale statuses cannot pile up", async () => {
    const cancel = vi.fn();
    const spoken = vi.fn();
    (globalThis as Record<string, unknown>).speechSynthesis = {
      cancel,
      speak: spoken,
    };
    (globalThis as Record<string, unknown>).SpeechSynthesisUtterance = class {
      constructor(public text: string) {}
    };
    await speak("hello");
    expect(cancel).toHaveBeenCalledOnce();
    expect(spoken).toHaveBeenCalledOnce();
  });
});

describe("speak — cloud first, local fallback", () => {
  const played: string[] = [];
  const pause = vi.fn();

  beforeEach(() => {
    played.length = 0;
    pause.mockClear();
    (globalThis as any).URL.createObjectURL = vi.fn(() => "blob:x");
    (globalThis as any).URL.revokeObjectURL = vi.fn();
    (globalThis as any).Audio = class {
      src: string;
      onended: (() => void) | null = null;
      constructor(src: string) {
        this.src = src;
      }
      play() {
        played.push(this.src);
        return Promise.resolve();
      }
      pause = pause;
    };
    (globalThis as any).speechSynthesis = { cancel: vi.fn(), speak: vi.fn() };
    (globalThis as any).SpeechSynthesisUtterance = class {
      constructor(public text: string) {}
    };
  });

  afterEach(() => {
    delete (globalThis as any).window.jarvis;
  });

  it("plays the cloud bytes when main returns some", async () => {
    (globalThis as any).window.jarvis = {
      ttsSpeak: vi.fn(() => Promise.resolve(new Uint8Array([1, 2, 3]))),
    };
    await speak("hello");
    expect(played).toEqual(["blob:x"]);
    expect((globalThis as any).speechSynthesis.speak).not.toHaveBeenCalled();
  });

  it("falls back to speechSynthesis when main returns null", async () => {
    (globalThis as any).window.jarvis = {
      ttsSpeak: vi.fn(() => Promise.resolve(null)),
    };
    await speak("hello");
    expect(played).toEqual([]);
    expect((globalThis as any).speechSynthesis.speak).toHaveBeenCalled();
  });

  it("falls back when the IPC call itself throws", async () => {
    (globalThis as any).window.jarvis = {
      ttsSpeak: vi.fn(() => Promise.reject(new Error("no main"))),
    };
    await speak("hello");
    expect((globalThis as any).speechSynthesis.speak).toHaveBeenCalled();
  });

  it("stops the previous cloud utterance before starting the next", async () => {
    (globalThis as any).window.jarvis = {
      ttsSpeak: vi.fn(() => Promise.resolve(new Uint8Array([1]))),
    };
    await speak("one");
    await speak("two");
    expect(pause).toHaveBeenCalled();
    expect(played).toEqual(["blob:x", "blob:x"]);
  });

  it("stopSpeaking silences both mouths — either may be the one talking", async () => {
    (globalThis as any).window.jarvis = {
      ttsSpeak: vi.fn(() => Promise.resolve(new Uint8Array([1]))),
    };
    await speak("one");
    stopSpeaking();
    expect(pause).toHaveBeenCalled();
    expect((globalThis as any).speechSynthesis.cancel).toHaveBeenCalled();
  });

  it("revokes the blob URL of an interrupted cloud utterance", async () => {
    (globalThis as any).window.jarvis = {
      ttsSpeak: vi.fn(() => Promise.resolve(new Uint8Array([1]))),
    };
    await speak("one");
    stopSpeaking();
    expect((globalThis as any).URL.revokeObjectURL).toHaveBeenCalledWith(
      "blob:x",
    );
  });

  it("does not let an overlapping speak() call end up playing", async () => {
    let resolveFirst!: (bytes: Uint8Array) => void;
    const first = new Promise<Uint8Array>((resolve) => {
      resolveFirst = resolve;
    });
    const ttsSpeak = vi
      .fn()
      .mockImplementationOnce(() => first)
      .mockImplementationOnce(() => Promise.resolve(new Uint8Array([2])));
    (globalThis as any).window.jarvis = { ttsSpeak };

    const p1 = speak("one"); // starts, then stalls awaiting its IPC round-trip
    const p2 = speak("two"); // starts and resolves while "one" is still stalled
    await p2;
    resolveFirst(new Uint8Array([1])); // "one" resolves last, after being superseded
    await p1;

    expect(played).toEqual(["blob:x"]); // only "two" ever played
    expect((globalThis as any).URL.createObjectURL).toHaveBeenCalledOnce(); // "one" never created a URL to revoke
  });
});

describe("isSpeaking", () => {
  // the playing audio is module state, so an earlier block's utterance is
  // still "current" here — clear it before, not only after, then run out the
  // deaf tail that stopping it just started
  beforeEach(() => {
    vi.useFakeTimers();
    stopSpeaking();
    vi.advanceTimersByTime(DEAF_TAIL_MS + 1);
  });
  afterEach(() => {
    stopSpeaking();
    vi.useRealTimers();
    delete (globalThis as { speechSynthesis?: unknown }).speechSynthesis;
  });

  it("is false when neither mouth is producing sound", () => {
    expect(isSpeaking()).toBe(false);
  });

  it("is true while speechSynthesis is talking", () => {
    (globalThis as { speechSynthesis?: unknown }).speechSynthesis = {
      speaking: true,
      cancel: () => undefined,
    };
    expect(isSpeaking()).toBe(true);
  });

  // Speaks through the local mouth (no window.jarvis here, so speak() gets no
  // cloud bytes) and hands back the end signal the browser would fire.
  const speakLocally = async (): Promise<() => void> => {
    let utterance: { onend?: () => void } | null = null;
    const synth = {
      speaking: false,
      cancel: () => undefined,
      speak: (u: { onend?: () => void }) => {
        utterance = u;
        synth.speaking = true;
      },
    };
    (globalThis as Record<string, unknown>).speechSynthesis = synth;
    (globalThis as Record<string, unknown>).SpeechSynthesisUtterance = class {
      onend?: () => void;
      constructor(public text: string) {}
    };
    await speak("jarvis finished the build");
    return () => {
      synth.speaking = false;
      utterance?.onend?.();
    };
  };

  it("stays deaf after the mouth closes, so the echo arrives too late", async () => {
    const finish = await speakLocally();
    expect(isSpeaking()).toBe(true);
    // whisper only hands over the app's own words once the room is quiet
    // again — which is after the mouth already stopped
    finish();
    vi.advanceTimersByTime(DEAF_TAIL_MS - 1);
    expect(isSpeaking()).toBe(true);
  });

  it("hears again once the tail runs out", async () => {
    const finish = await speakLocally();
    finish();
    vi.advanceTimersByTime(DEAF_TAIL_MS + 1);
    expect(isSpeaking()).toBe(false);
  });
});

describe("readWave — the analyser behind the wave", () => {
  const connected: string[] = [];
  const sample = 200;

  const install = () => {
    connected.length = 0;
    (globalThis as any).URL.createObjectURL = vi.fn(() => "blob:x");
    (globalThis as any).URL.revokeObjectURL = vi.fn();
    (globalThis as any).Audio = class {
      src: string;
      ended = false;
      paused = false;
      onended: (() => void) | null = null;
      constructor(src: string) {
        this.src = src;
      }
      play() {
        return Promise.resolve();
      }
      pause = vi.fn();
    };
    (globalThis as any).AudioContext = class {
      state = "running";
      destination = { id: "destination" };
      createAnalyser() {
        return {
          fftSize: 0,
          smoothingTimeConstant: 0,
          connect: (n: any) => connected.push(`analyser->${n.id}`),
          getByteTimeDomainData: (out: Uint8Array) => out.fill(sample),
        };
      }
      createMediaElementSource() {
        return {
          connect: () => connected.push("source->analyser"),
          disconnect: () => connected.push("source-disconnect"),
        };
      }
      resume() {
        return Promise.resolve();
      }
    };
    (globalThis as any).window.jarvis = {
      ttsSpeak: vi.fn(() => Promise.resolve(new Uint8Array([1]))),
    };
  };

  afterEach(() => {
    stopSpeaking();
    delete (globalThis as any).AudioContext;
    delete (globalThis as any).window.jarvis;
  });

  it("connects the analyser to the destination, or the voice goes silent", async () => {
    install();
    await speak("hello");
    expect(connected).toContain("analyser->destination");
    expect(connected).toContain("source->analyser");
  });

  it("reads the live waveform while the cloud mouth is playing", async () => {
    install();
    await speak("hello");
    const out = new Uint8Array(WAVE_BINS);
    expect(readWave(out)).toBe(true);
    expect(out[0]).toBe(sample);
  });

  it("reports not-live once the utterance is stopped", async () => {
    install();
    await speak("hello");
    stopSpeaking();
    expect(readWave(new Uint8Array(WAVE_BINS))).toBe(false);
  });

  it("reports not-live for the local mouth, which no node can see", async () => {
    install();
    (globalThis as any).window.jarvis = {
      ttsSpeak: vi.fn(() => Promise.resolve(null)),
    };
    (globalThis as any).speechSynthesis = {
      cancel: vi.fn(),
      speak: vi.fn(),
      speaking: true,
    };
    await speak("hello");
    expect(isSounding()).toBe(true); // the head still moves
    expect(readWave(new Uint8Array(WAVE_BINS))).toBe(false); // the wave cannot
  });

  // fresh module: the analyser is module state, so a context built by an
  // earlier test in this file would survive into a "no Web Audio" one
  const freshSpeak = async () => {
    vi.resetModules();
    return import("../../src/renderer/voice/speak");
  };

  it("still speaks, with a flat wave, when wiring throws", async () => {
    install();
    (globalThis as any).AudioContext = class {
      constructor() {
        throw new Error("no web audio");
      }
    };
    const mod = await freshSpeak();
    await expect(mod.speak("hello")).resolves.toBeUndefined();
    expect(mod.readWave(new Uint8Array(mod.WAVE_BINS))).toBe(false);
    mod.stopSpeaking();
  });

  it("still speaks, with a flat wave, on a platform with no Web Audio", async () => {
    install();
    delete (globalThis as any).AudioContext;
    const mod = await freshSpeak();
    await expect(mod.speak("hello")).resolves.toBeUndefined();
    expect(mod.readWave(new Uint8Array(mod.WAVE_BINS))).toBe(false);
    mod.stopSpeaking();
  });

  it("never routes through a suspended context, which would mute the voice", async () => {
    install();
    const Base = (globalThis as any).AudioContext;
    (globalThis as any).AudioContext = class extends Base {
      state = "suspended";
      resume = vi.fn(() => Promise.resolve());
    };
    const mod = await freshSpeak();
    await mod.speak("hello");
    expect(connected).not.toContain("source->analyser"); // element left audible
    expect(mod.readWave(new Uint8Array(mod.WAVE_BINS))).toBe(false);
    mod.stopSpeaking();
  });

  it("wires one source per utterance and drops the one before it", async () => {
    install();
    await speak("one");
    await speak("two");
    expect(connected.filter((c) => c === "source->analyser")).toHaveLength(2);
    expect(connected).toContain("source-disconnect");
  });
});
