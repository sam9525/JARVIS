// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/no-explicit-any */
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import VoiceWave, { amplitudeOf } from "../../src/renderer/voice/VoiceWave";
import * as speak from "../../src/renderer/voice/speak";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

describe("amplitudeOf", () => {
  it("is 0 for a silent buffer, which sits flat on the 128 centre line", () => {
    expect(amplitudeOf(new Uint8Array(64).fill(128))).toBe(0);
  });

  it("is 1 at full deflection, in either direction", () => {
    expect(amplitudeOf(new Uint8Array([128, 0, 128]))).toBe(1);
    expect(amplitudeOf(new Uint8Array([128, 255, 128]))).toBeCloseTo(1, 1);
  });

  it("reads the peak, not the last sample", () => {
    expect(amplitudeOf(new Uint8Array([128, 192, 128]))).toBeCloseTo(0.5, 2);
  });
});

describe("VoiceWave", () => {
  let root: Root;
  let container: HTMLDivElement;
  const strokes: string[] = [];

  beforeEach(() => {
    strokes.length = 0;
    // jsdom has no canvas backend; the component only needs a 2D-ish context
    (HTMLCanvasElement.prototype as any).getContext = () => ({
      scale: vi.fn(),
      clearRect: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(() => strokes.push("stroke")),
      set strokeStyle(_v: string) {
        /* colour is not what these tests assert */
      },
      lineWidth: 0,
      lineJoin: "",
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    act(() => {
      root = createRoot(container);
    });
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  const mouth = () =>
    container.querySelector('[data-testid="voice-mouth"]') as SVGElement;

  it("renders the head and a flat wave when nothing is talking", () => {
    vi.spyOn(speak, "readWave").mockReturnValue(false);
    vi.spyOn(speak, "isSounding").mockReturnValue(false);
    act(() => root.render(<VoiceWave />));
    expect(
      container.querySelector('[data-testid="voice-head"]'),
    ).not.toBeNull();
    expect(strokes.length).toBeGreaterThan(0); // the flat line is drawn once
  });

  it("keeps the mouth shut while silent", () => {
    vi.spyOn(speak, "readWave").mockReturnValue(false);
    vi.spyOn(speak, "isSounding").mockReturnValue(false);
    act(() => root.render(<VoiceWave />));
    expect(Number(mouth().getAttribute("ry"))).toBeLessThan(1);
  });

  it("opens the mouth to the waveform amplitude while speaking", () => {
    vi.spyOn(speak, "isSounding").mockReturnValue(true);
    vi.spyOn(speak, "readWave").mockImplementation((out: Uint8Array) => {
      out.fill(128);
      out[0] = 255; // full deflection
      return true;
    });
    act(() => root.render(<VoiceWave />));
    expect(Number(mouth().getAttribute("ry"))).toBeGreaterThan(3);
  });

  it("is transparent to the pointer, so it cannot steal a scrubber click", () => {
    vi.spyOn(speak, "readWave").mockReturnValue(false);
    vi.spyOn(speak, "isSounding").mockReturnValue(false);
    act(() => root.render(<VoiceWave />));
    const wave = container.querySelector(
      '[data-testid="voice-wave"]',
    ) as HTMLElement;
    expect(wave.className.split(/\s+/)).toContain("pointer-events-none");
  });
});
