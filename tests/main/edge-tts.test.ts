import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { PassThrough, Readable } from "node:stream";
import {
  createEdgeTts,
  EDGE_VOICE,
  speechChunks,
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

// every failure logs one line; keep the test output clean and checkable
let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("speechChunks", () => {
  const a = "w ".repeat(30).trim();

  it("leaves short sentences as they are", () => {
    expect(speechChunks("One. Two! Three?")).toEqual([
      "One.",
      "Two!",
      "Three?",
    ]);
    expect(speechChunks("Updated to 2.1.1 today. Done.")).toEqual([
      "Updated to 2.1.1 today.",
      "Done.",
    ]);
  });

  it("keeps a 100-character sentence whole and splits one of 101", () => {
    const s100 = "x".repeat(49) + " " + "y".repeat(49) + ".";
    expect(s100).toHaveLength(100);
    expect(speechChunks(s100)).toEqual([s100]);
    const s101 = "x".repeat(50) + " " + "y".repeat(49) + ".";
    expect(speechChunks(s101)).toEqual(["x".repeat(50), "y".repeat(49) + "."]);
  });

  it.each([",", ";", ":"])(
    "splits at the last %s that fits, again on the rest",
    (m) => {
      expect(speechChunks(`${a}${m} ${a}${m} ${a}.`)).toEqual([
        `${a}${m}`,
        `${a}${m}`,
        `${a}.`,
      ]);
    },
  );

  it.each([" -", "—", "–"])(
    "splits after a %j dash and keeps it on the left",
    (d) => {
      expect(speechChunks(`${a}${d} ${a}.`)).toEqual([`${a}${d}`, `${a}.`]);
    },
  );

  it("never splits inside 1,000", () => {
    const s = `${a} cost 1,000 dollars and ${a}.`;
    const parts = speechChunks(s);
    expect(parts.some((p) => p.endsWith("1,"))).toBe(false);
    expect(parts[0]).toBe(s.slice(0, 100));
    expect(parts[0]).toContain("1,000");
    expect(parts.join(" ")).toBe(s);
  });

  it("treats a newline or tab like a space", () => {
    const list = "item\n".repeat(60) + "end.";
    const parts = speechChunks(list);
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(100);
    expect(parts.join(" ")).toBe(list.replace(/\s+/g, " "));
    expect(speechChunks(`${a}:\n${a}.`)).toEqual([`${a}:`, `${a}.`]);
    expect(speechChunks(`${a},\t${a}.`)).toEqual([`${a},`, `${a}.`]);
  });

  it("never sends a dash alone", () => {
    const x = "x".repeat(50);
    const y = "y".repeat(60);
    expect(speechChunks(`— ${x} ${y}`)).toEqual([`— ${x}`, y]);
  });

  it("splits at a mark on index 99 but not on index 100", () => {
    const at99 = "x".repeat(99) + ", tail";
    expect(speechChunks(at99)).toEqual(["x".repeat(99) + ",", "tail"]);
    const at100 = "x".repeat(49) + " " + "y".repeat(50) + ", zzz";
    expect(speechChunks(at100)).toEqual([
      "x".repeat(49),
      "y".repeat(50) + ", zzz",
    ]);
  });

  it("splits at spaces when there is no pause mark", () => {
    const s = ("word ".repeat(50) + "end.").trim();
    const parts = speechChunks(s);
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(100);
    expect(parts.join(" ")).toBe(s);
  });

  it("keeps one word over 100 characters whole and splits what follows", () => {
    const long = "x".repeat(150);
    expect(speechChunks(`${long} tail.`)).toEqual([long, "tail."]);
  });
});

describe("edge.speak", () => {
  it("sends a long sentence to Edge in parts", async () => {
    const seen: string[] = [];
    const { Client } = fakeClient({
      stream: (text) => {
        seen.push(text);
        return Readable.from([Buffer.from([1])]);
      },
    });
    const a = "w ".repeat(30).trim();
    await createEdgeTts({ Client }).speak(`${a}, ${a}.`);
    expect([...seen].sort()).toEqual([`${a},`, `${a}.`].sort());
  });

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
    await vi.advanceTimersByTimeAsync(16_000);
    expect(await pending).toBe(null);
    expect(made).toHaveLength(2);
    expect(made[0].close).toHaveBeenCalledTimes(1);
    expect(made[1].close).toHaveBeenCalledTimes(1);
  });

  it("keeps a slow sentence that is still sending past 8 s", async () => {
    vi.useFakeTimers();
    // four chunks 5 s apart: 20 s in all, never 8 s without data
    const { Client } = fakeClient({
      stream: () =>
        Readable.from(
          (async function* () {
            for (let i = 1; i <= 4; i++) {
              await new Promise((r) => setTimeout(r, 5000));
              yield Buffer.from([i]);
            }
          })(),
        ),
    });
    const pending = createEdgeTts({ Client }).speak("A long sentence.");
    await vi.advanceTimersByTimeAsync(20_000);
    expect(await pending).toEqual(new Uint8Array([1, 2, 3, 4]));
    expect(warn).not.toHaveBeenCalled();
  });

  it("fails a silent sentence at 8 s with no chunk, not before", async () => {
    vi.useFakeTimers();
    const { Client } = fakeClient({ stream: () => new PassThrough() });
    let settled = false;
    const pending = createEdgeTts({ Client })
      .speak("Never answered.")
      .finally(() => (settled = true));
    await vi.advanceTimersByTimeAsync(7999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(warn).toHaveBeenCalledWith(
      "[edge] sentence failed: no audio for 8000 ms",
    );
    await vi.advanceTimersByTimeAsync(8000);
    expect(await pending).toBe(null);
  });

  it("logs the reason of a failed sentence but never its text", async () => {
    const { Client } = fakeClient({
      setMetadata: () =>
        Promise.reject(new Error("Unexpected server response: 403")),
    });
    await createEdgeTts({ Client }).speak("Secret plan for Tuesday.");
    expect(warn).toHaveBeenCalledWith(
      "[edge] sentence failed: Unexpected server response: 403",
    );
    expect(String(warn.mock.calls)).not.toContain("Secret plan");
  });
});

describe("edge.speak retry", () => {
  it("retries a part that fails once and keeps the line", async () => {
    let calls = 0;
    const log = vi.fn();
    const { Client, made } = fakeClient({
      stream: () =>
        ++calls === 1 ? Readable.from([]) : Readable.from([Buffer.from([7])]),
    });
    expect(await createEdgeTts({ Client, log }).speak("hi")).toEqual(
      new Uint8Array([7]),
    );
    expect(made).toHaveLength(2);
    expect(log.mock.calls[0][0]).toMatch(
      /^part 1\/1 chars 2 try 1 empty stream after \d+ ms → retrying$/,
    );
    expect(log.mock.calls[1][0]).toMatch(
      /^part 1\/1 chars 2 try 2 ok after \d+ ms$/,
    );
  });

  it("drops the line when the retry fails too", async () => {
    const log = vi.fn();
    const { Client, made } = fakeClient({ stream: () => Readable.from([]) });
    expect(await createEdgeTts({ Client, log }).speak("hi")).toBe(null);
    expect(made).toHaveLength(2);
    expect(log.mock.calls.map((c) => c[0])).toEqual([
      expect.stringMatching(/try 1 empty stream after \d+ ms → retrying$/),
      expect.stringMatching(/try 2 empty stream after \d+ ms → line dropped$/),
    ]);
  });

  it("retries a part that stays silent past 8 s", async () => {
    vi.useFakeTimers();
    let calls = 0;
    const { Client } = fakeClient({
      stream: () =>
        ++calls === 1 ? new PassThrough() : Readable.from([Buffer.from([5])]),
    });
    const pending = createEdgeTts({ Client }).speak("hi");
    await vi.advanceTimersByTimeAsync(8000);
    expect(await pending).toEqual(new Uint8Array([5]));
  });

  it("names the part by position and never logs its text", async () => {
    const log = vi.fn();
    const { Client } = fakeClient({
      stream: (text) =>
        text === "Secret plan."
          ? Readable.from([])
          : Readable.from([Buffer.from([1])]),
    });
    await createEdgeTts({ Client, log }).speak("Good. Secret plan. Good.");
    expect(log.mock.calls[0][0]).toMatch(/^part 2\/3 chars 12 try 1 /);
    expect(String(log.mock.calls)).not.toContain("Secret");
  });

  it("logs nothing for a line with no failure", async () => {
    const log = vi.fn();
    const { Client } = fakeClient({
      stream: () => Readable.from([Buffer.from([1])]),
    });
    await createEdgeTts({ Client, log }).speak("One. Two.");
    expect(log).not.toHaveBeenCalled();
  });
});
