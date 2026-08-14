// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { nextUtterance, speak } from "../../src/renderer/voice/speak";
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

  it("does nothing when the platform has no speech synthesis", () => {
    expect(() => speak("hello")).not.toThrow();
  });

  it("cancels queued speech first, so stale statuses cannot pile up", () => {
    const cancel = vi.fn();
    const spoken = vi.fn();
    (globalThis as Record<string, unknown>).speechSynthesis = {
      cancel,
      speak: spoken,
    };
    speak("hello");
    expect(cancel).toHaveBeenCalledOnce();
    expect(spoken).toHaveBeenCalledOnce();
  });
});
