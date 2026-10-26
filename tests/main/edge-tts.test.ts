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
  stream?: (text: string) => NodeJS.ReadableStream;
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
    toStream(text: string) {
      return { audioStream: (opts.stream ?? (() => Readable.from([])))(text) };
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
    const { Client, made } = fakeClient({ stream: () => Readable.from([]) });
    expect(await createEdgeTts({ Client }).speak("hi")).toBe(null);
    expect(made[0].close).toHaveBeenCalledTimes(1);
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

  it("fetches each sentence on its own and joins the bytes in line order", async () => {
    // the first sentence finishes last, so arrival order is not line order
    const delays: Record<string, number> = {
      "One.": 30,
      "Two!": 0,
      "Three?": 10,
    };
    const codes: Record<string, number> = { "One.": 1, "Two!": 2, "Three?": 3 };
    const { Client, made } = fakeClient({
      stream: (text) =>
        Readable.from(
          (async function* () {
            await new Promise((r) => setTimeout(r, delays[text]));
            yield Buffer.from([codes[text]]);
          })(),
        ),
    });
    const out = await createEdgeTts({ Client }).speak("One. Two! Three?");
    expect(out).toEqual(new Uint8Array([1, 2, 3]));
    expect(made).toHaveLength(3);
    for (const c of made) expect(c.close).toHaveBeenCalledTimes(1);
  });

  it("keeps a version number whole instead of splitting at its dots", async () => {
    const seen: string[] = [];
    const { Client } = fakeClient({
      stream: (text) => {
        seen.push(text);
        return Readable.from([Buffer.from([1])]);
      },
    });
    await createEdgeTts({ Client }).speak("Updated to 2.1.1 today. Done.");
    expect(seen).toEqual(["Updated to 2.1.1 today.", "Done."]);
  });

  it("is null for the whole line when one sentence fails", async () => {
    const { Client } = fakeClient({
      stream: (text) =>
        text === "Bad."
          ? new Readable({
              read() {
                this.destroy(new Error("403"));
              },
            })
          : Readable.from([Buffer.from([1])]),
    });
    expect(await createEdgeTts({ Client }).speak("Good. Bad. Good.")).toBe(
      null,
    );
  });

  it("holds at most four sockets open at once", async () => {
    let open = 0;
    let peak = 0;
    const { Client } = fakeClient({
      stream: () =>
        Readable.from(
          (async function* () {
            peak = Math.max(peak, ++open);
            await new Promise((r) => setTimeout(r, 5));
            open--;
            yield Buffer.from([1]);
          })(),
        ),
    });
    const line = Array.from({ length: 9 }, (_, i) => `Part ${i}.`).join(" ");
    const out = await createEdgeTts({ Client }).speak(line);
    expect(out).toHaveLength(9);
    expect(peak).toBe(4);
  });

  it("is null for whitespace-only text and makes no client", async () => {
    const { Client, made } = fakeClient({});
    expect(await createEdgeTts({ Client }).speak("  \n ")).toBe(null);
    expect(made).toHaveLength(0);
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
