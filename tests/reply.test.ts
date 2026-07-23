import { describe, it, expect, vi, beforeEach } from "vitest";
import { sendReply } from "../src/renderer/reply";

const ptyInput = vi.fn();

beforeEach(() => {
  ptyInput.mockReset();
  // sendReply reads window.jarvis.ptyInput, the same pipe TerminalPanel uses
  (globalThis as unknown as { window: unknown }).window = {
    jarvis: { ptyInput },
  };
});

describe("sendReply", () => {
  it("sends the text with a trailing carriage return", () => {
    expect(sendReply("w1", "yes")).toBe(true);
    expect(ptyInput).toHaveBeenCalledWith("w1", "yes\r");
  });

  it("does not send an empty or whitespace-only reply", () => {
    expect(sendReply("w1", "   ")).toBe(false);
    expect(ptyInput).not.toHaveBeenCalled();
  });
});
