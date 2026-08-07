// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  installMediaPipeTelemetryBlock,
  MEDIAPIPE_LOG_URL,
} from "../../src/renderer/hands/hand-tracker";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("installMediaPipeTelemetryBlock", () => {
  it("swallows MediaPipe ODML telemetry without reaching CSP", async () => {
    const fetch = vi.fn(() => Promise.resolve(new Response("ok")));
    globalThis.fetch = fetch as unknown as typeof globalThis.fetch;

    const restore = installMediaPipeTelemetryBlock();
    const res = await globalThis.fetch(MEDIAPIPE_LOG_URL, { method: "POST" });

    expect(res.status).toBe(204);
    expect(fetch).not.toHaveBeenCalled();
    restore();
  });

  // matched by host, so a decorated URL cannot slip past to the CSP
  it("swallows it however the SDK decorates the URL", async () => {
    const fetch = vi.fn(() => Promise.resolve(new Response("ok")));
    globalThis.fetch = fetch as unknown as typeof globalThis.fetch;

    const restore = installMediaPipeTelemetryBlock();
    for (const url of [
      `${MEDIAPIPE_LOG_URL}?alt=proto&key=abc123`,
      "https://odml.pa.googleapis.com/v2/log",
      new Request(MEDIAPIPE_LOG_URL, { method: "POST" }),
    ]) {
      expect((await globalThis.fetch(url)).status).toBe(204);
    }
    restore();

    expect(fetch).not.toHaveBeenCalled();
  });

  it("passes every other request through and restores the original fetch", async () => {
    const fetch = vi.fn(() => Promise.resolve(new Response("ok")));
    globalThis.fetch = fetch as unknown as typeof globalThis.fetch;

    const restore = installMediaPipeTelemetryBlock();
    await globalThis.fetch("/hands/hand_landmarker.task");
    restore();

    expect(fetch).toHaveBeenCalledWith(
      "/hands/hand_landmarker.task",
      undefined,
    );
    expect(globalThis.fetch).toBe(fetch);
  });
});
