import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { sendReply } from "../../src/renderer/terminal/reply";

const ptyInput = vi.fn();

beforeEach(() => {
  vi.useFakeTimers();
  ptyInput.mockReset();
  // sendReply reads window.jarvis.ptyInput, the same pipe TerminalPanel uses
  (globalThis as unknown as { window: unknown }).window = {
    jarvis: { ptyInput },
  };
});

afterEach(() => vi.useRealTimers());

describe("sendReply", () => {
  // the CR is a separate, later write so the TUI reads it as Enter, not paste
  it("sends the text, then the carriage return", () => {
    expect(sendReply("w1", "yes")).toBe(true);
    expect(ptyInput.mock.calls).toEqual([["w1", "yes"]]);
    vi.runAllTimers();
    expect(ptyInput.mock.calls).toEqual([
      ["w1", "yes"],
      ["w1", "\r"],
    ]);
  });

  it("does not send an empty or whitespace-only reply", () => {
    expect(sendReply("w1", "   ")).toBe(false);
    vi.runAllTimers();
    expect(ptyInput).not.toHaveBeenCalled();
  });
});
