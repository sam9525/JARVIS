import { describe, it, expect, vi } from "vitest";
import { createTts } from "../../src/main/tts";

const cfg = { apiKey: "k", voiceId: "v1", modelId: "m1" };
const ok = (body: unknown) =>
  ({
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
    arrayBuffer: () => Promise.resolve(body as ArrayBuffer),
  }) as unknown as Response;
const bad = (status: number) =>
  ({
    ok: false,
    status,
    json: () => Promise.reject(new Error("no")),
  }) as unknown as Response;

describe("tts.speak", () => {
  it("posts to the voice endpoint and returns the mp3 bytes", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const fetch = vi.fn(() => Promise.resolve(ok(bytes.buffer)));
    const out = await createTts({ fetch: fetch as never }).speak(cfg, "hello");
    expect(out).toEqual(bytes);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/v1/text-to-speech/v1");
    expect(url).toContain("output_format=mp3_44100_128");
    expect((init.headers as Record<string, string>)["xi-api-key"]).toBe("k");
    expect(JSON.parse(String(init.body))).toEqual({
      text: "hello",
      model_id: "m1",
    });
  });

  it("is null with no key, so the caller falls back rather than calling out", async () => {
    const fetch = vi.fn();
    const out = await createTts({ fetch: fetch as never }).speak(
      { ...cfg, apiKey: "" },
      "hello",
    );
    expect(out).toBe(null);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([401, 429, 500])("is null on %i", async (status) => {
    const fetch = vi.fn(() => Promise.resolve(bad(status)));
    expect(await createTts({ fetch: fetch as never }).speak(cfg, "hi")).toBe(
      null,
    );
  });

  it("is null when the request throws, so a timeout cannot wedge the mouth", async () => {
    const fetch = vi.fn(() => Promise.reject(new Error("aborted")));
    expect(await createTts({ fetch: fetch as never }).speak(cfg, "hi")).toBe(
      null,
    );
  });
});

describe("tts.voices / tts.models", () => {
  it("parses the voice list, tags the account's own and sorts them first", async () => {
    const fetch = vi.fn(() =>
      Promise.resolve(
        ok({
          voices: [
            { voice_id: "v1", name: "Rachel", category: "premade" },
            {
              voice_id: "v2",
              name: "My Clone",
              category: "cloned",
              is_owner: true,
            },
            { voice_id: "v3", name: "Adam", category: "premade" },
          ],
        }),
      ),
    );
    expect(await createTts({ fetch: fetch as never }).voices("k")).toEqual([
      { id: "v2", name: "My Clone", mine: true },
      { id: "v1", name: "Rachel", mine: false },
      { id: "v3", name: "Adam", mine: false },
    ]);
  });

  // a Voice Library copy is category "professional" and sits in the account's
  // own list, but the account did not make it — is_owner is the only signal
  it("does not claim a voice copied from the library", async () => {
    const fetch = vi.fn(() =>
      Promise.resolve(
        ok({
          voices: [
            {
              voice_id: "v1",
              name: "Savvy",
              category: "professional",
              is_owner: false,
              sharing: { status: "copied" },
            },
          ],
        }),
      ),
    );
    expect(await createTts({ fetch: fetch as never }).voices("k")).toEqual([
      { id: "v1", name: "Savvy", mine: false },
    ]);
  });

  it("parses the model list", async () => {
    const fetch = vi.fn(() =>
      Promise.resolve(ok([{ model_id: "m1", name: "Turbo" }])),
    );
    expect(await createTts({ fetch: fetch as never }).models("k")).toEqual([
      { id: "m1", name: "Turbo" },
    ]);
  });

  it("is empty on a rejected key and on a malformed body", async () => {
    const tts = createTts({
      fetch: (() => Promise.resolve(bad(401))) as never,
    });
    expect(await tts.voices("k")).toEqual([]);
    const junk = createTts({
      fetch: (() => Promise.resolve(ok({ nope: 1 }))) as never,
    });
    expect(await junk.models("k")).toEqual([]);
  });

  it("stays empty with no key, and never calls out", async () => {
    const fetch = vi.fn();
    const tts = createTts({ fetch: fetch as never });
    expect(await tts.voices("")).toEqual([]);
    expect(await tts.models("")).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });
});
