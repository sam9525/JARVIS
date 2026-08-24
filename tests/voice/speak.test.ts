// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import {
  nextUtterance,
  speak,
  stopSpeaking,
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

  it("never speaks a message containing the wake word, so the mouth cannot feed the ears", () => {
    expect(nextUtterance(status("Jarvis, build is green"), "", false)).toBe(
      null,
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
