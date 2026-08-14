// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/no-explicit-any */
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import VoiceToggle from "../../src/renderer/voice/VoiceToggle";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  act(() => {
    root = createRoot(container);
  });
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});
const render = (el: React.ReactElement) => act(() => root.render(el));
const button = () =>
  container.querySelector('[data-testid="voice-toggle"]') as HTMLElement;
const glyph = () =>
  container.querySelector('[data-testid="voice-glyph"]') as HTMLElement;

// The button carries a static `hover:border-accent`, which contains
// "border-accent" as a substring — so toContain on the raw string would pass
// in every state. Assert exact class tokens instead. The same trap is
// documented in tests/hands/HandToggle.test.tsx; keep this token-based.
const classTokens = (el: HTMLElement) => el.className.split(/\s+/);

const base = {
  micOn: false,
  capturing: false,
  error: null as string | null,
  onToggle: () => undefined,
};

describe("VoiceToggle", () => {
  it("is idle when the microphone is off", () => {
    render(<VoiceToggle {...base} />);
    expect(classTokens(button())).toContain("border-edge");
    expect(glyph().className).not.toContain("animate-pulse");
  });

  it("is lit when the microphone is on", () => {
    render(<VoiceToggle {...base} micOn={true} />);
    expect(classTokens(button())).toContain("border-accent");
  });

  it("pulses while capturing, so you can see it is still listening", () => {
    render(<VoiceToggle {...base} micOn={true} capturing={true} />);
    expect(glyph().className).toContain("animate-pulse");
  });

  it("shows a failure as warm, with the reason in the title", () => {
    render(<VoiceToggle {...base} error="Microphone permission denied" />);
    expect(classTokens(button())).toContain("border-warm");
    expect(button().getAttribute("title")).toContain(
      "Microphone permission denied",
    );
  });

  it("names the wake word in the title while on", () => {
    render(<VoiceToggle {...base} micOn={true} />);
    expect(button().getAttribute("title")).toContain("jarvis");
  });

  it("toggles on click", () => {
    const onToggle = vi.fn();
    render(<VoiceToggle {...base} onToggle={onToggle} />);
    act(() => button().click());
    expect(onToggle).toHaveBeenCalledOnce();
  });
});
