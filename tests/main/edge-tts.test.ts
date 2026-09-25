import { describe, it, expect, vi, afterEach } from "vitest";
import { PassThrough, Readable } from "node:stream";
import {
  createEdgeTts,
  EDGE_VOICE,
  type EdgeClient,
} from "../../src/main/edge-tts";

// A fake MsEdgeTTS: each test decides what the stream does, and every
// instance is recorded so the test can check close() was called.
function fakeClient(opts: {
  stream?: () => NodeJS.ReadableStream;
  setMetadata?: () => Promise<void>;
}) {
  const made: {
    close: ReturnType<typeof vi.fn>;
    setMetadata: ReturnType<typeof vi.fn>;
  }[] = [];
  class Client implements EdgeClient {
    close = vi.fn();
    setMetadata = vi.fn(opts.setMetadata ?? (() => Promise.resolve()));
    constructor() {
      made.push(this);
    }
    toStream() {
      return { audioStream: (opts.stream ?? (() => Readable.from([])))() };
    }
  }
  return { Client, made };
}

afterEach(() => vi.useRealTimers());

describe("edge.speak", () => {
  it("returns the concatenated stream bytes and closes the client", async () => {
    const { Client, made } = fakeClient({
      stream: () => Readable.from([Buffer.from([1, 2]), Buffer.from([3])]),
    });
    const out = await createEdgeTts({ Client }).speak("hello");
    expect(out).toEqual(new Uint8Array([1, 2, 3]));
    expect(made[0].setMetadata).toHaveBeenCalledWith(
      EDGE_VOICE,
      "audio-24khz-48kbitrate-mono-mp3",
    );
    expect(made[0].close).toHaveBeenCalledTimes(1);
  });

  it("is null for empty text and makes no client", async () => {
    const { Client, made } = fakeClient({});
    expect(await createEdgeTts({ Client }).speak("")).toBe(null);
    expect(made).toHaveLength(0);
  });

  it("is null on an empty stream, so silence never reaches the renderer", async () => {
    const { Client } = fakeClient({ stream: () => Readable.from([]) });
    expect(await createEdgeTts({ Client }).speak("hi")).toBe(null);
  });

  it("is null and closes when setMetadata throws", async () => {
    const { Client, made } = fakeClient({
      setMetadata: () => Promise.reject(new Error("403")),
    });
    expect(await createEdgeTts({ Client }).speak("hi")).toBe(null);
    expect(made[0].close).toHaveBeenCalledTimes(1);
  });

  it("is null and closes when the stream errors", async () => {
    const { Client, made } = fakeClient({
      stream: () =>
        new Readable({
          read() {
            this.destroy(new Error("socket closed"));
          },
        }),
    });
    expect(await createEdgeTts({ Client }).speak("hi")).toBe(null);
    expect(made[0].close).toHaveBeenCalledTimes(1);
  });

  it("is null and closes when the stream never ends within the timeout", async () => {
    vi.useFakeTimers();
    const { Client, made } = fakeClient({ stream: () => new PassThrough() });
    const pending = createEdgeTts({ Client }).speak("hi");
    await vi.advanceTimersByTimeAsync(8000);
    expect(await pending).toBe(null);
    expect(made[0].close).toHaveBeenCalledTimes(1);
  });
});
