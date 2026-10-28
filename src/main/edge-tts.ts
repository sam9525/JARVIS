// Microsoft's Edge read-aloud voice: the tier between ElevenLabs and the OS
// voice, because it has no quota to spend. Pure over an injected client, so
// tests need no network. Answers null for every failure, like tts.ts.

/** The one voice this tier speaks with. A fallback needs a voice, not a menu. */
export const EDGE_VOICE = "en-US-AvaMultilingualNeural";
// MP3, because the renderer wraps the bytes as audio/mpeg.
const FORMAT = "audio-24khz-48kbitrate-mono-mp3";
// Edge sends audio at about real time, so a long sentence is still arriving
// after 8 s. The cap is on silence: a socket that sends nothing for this long
// is dead, however long the sentence.
const IDLE_MS = 8000;
// Eight sentences take about 4.8 s over 2 sockets, 2.4 s over 4 and 1.5 s
// over 8. 4 keeps a 500-char line under 3 s without a socket per sentence.
const PARALLEL = 4;

// A stop counts only before a space or the end, so "2.1.1" stays whole.
const sentences = (text: string): string[] =>
  (text.match(/[\s\S]*?[.!?]+(?=\s|$)|[\s\S]+$/g) ?? [])
    .map((s) => s.trim())
    .filter(Boolean);

/** The longest text one Edge request carries. */
export const MAX_CHUNK_CHARS = 100;

// Index just past the last pause mark that fits in a chunk, or -1. A mark
// counts only before a space, so "1,000" stays whole; a hyphen counts only
// after a space too, so "well-known" does too.
function lastPauseEnd(text: string): number {
  for (let i = MAX_CHUNK_CHARS - 1; i >= 0; i--) {
    const mark = text[i];
    if (text[i + 1] !== " ") continue;
    if (mark === "," || mark === ";" || mark === ":") return i + 1;
    if (mark === "—" || mark === "–") return i + 1;
    if (mark === "-" && text[i - 1] === " ") return i + 1;
  }
  return -1;
}

/** Sentences, with any over MAX_CHUNK_CHARS cut at a pause mark, else at a
 * space; a single word longer than the cap stays whole. */
export function speechChunks(text: string): string[] {
  const chunks: string[] = [];
  for (const sentence of sentences(text)) {
    let rest = sentence;
    while (rest.length > MAX_CHUNK_CHARS) {
      const pause = lastPauseEnd(rest);
      const space = rest.lastIndexOf(" ", MAX_CHUNK_CHARS);
      const cut = pause > 0 ? pause : space > 0 ? space : rest.indexOf(" ");
      if (cut < 0) break;
      chunks.push(rest.slice(0, cut).trim());
      rest = rest.slice(cut).trim();
    }
    chunks.push(rest);
  }
  return chunks;
}

/** The structural subset of MsEdgeTTS this module uses — the same trick
 * `PtyLike` plays for node-pty, so tests inject a fake and need no network. */
export interface EdgeClient {
  setMetadata(voice: string, format: string): Promise<void>;
  toStream(text: string): { audioStream: NodeJS.ReadableStream };
  close(): void;
}

export interface EdgeTtsDeps {
  Client: new () => EdgeClient;
}

export function createEdgeTts(deps: EdgeTtsDeps) {
  // A client per call: the socket idles out between utterances, and a
  // reconnect-on-stale path costs more than a handshake saves.
  async function speakSentence(text: string): Promise<Uint8Array | null> {
    let client: EdgeClient | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // The reason only, never the sentence: the log must not carry the line.
    const fail = (reason: string) => {
      console.warn(`[edge] sentence failed: ${reason.slice(0, 160)}`);
      return null;
    };
    try {
      const c = (client = new deps.Client());
      let quiet!: () => void;
      const timeout = new Promise<"quiet">((resolve) => {
        quiet = () => resolve("quiet");
      });
      const rearm = () => {
        clearTimeout(timer);
        timer = setTimeout(quiet, IDLE_MS);
      };
      const collect = async () => {
        rearm();
        await c.setMetadata(EDGE_VOICE, FORMAT);
        rearm();
        const chunks: Buffer[] = [];
        for await (const chunk of c.toStream(text).audioStream) {
          rearm();
          chunks.push(Buffer.from(chunk as Buffer));
        }
        return new Uint8Array(Buffer.concat(chunks));
      };
      // The loser of the race still settles later; its catch keeps a late
      // stream error from surfacing as an unhandled rejection.
      const result = await Promise.race([
        collect().catch((err: unknown) =>
          err instanceof Error ? err : new Error(String(err)),
        ),
        timeout,
      ]);
      if (result === "quiet") return fail(`no audio for ${IDLE_MS} ms`);
      if (result instanceof Error) return fail(result.message);
      return result.length ? result : fail("empty stream");
    } catch (err) {
      return fail(err instanceof Error ? err.message : String(err));
    } finally {
      clearTimeout(timer);
      client?.close();
    }
  }

  return {
    // Edge sends audio at about real time, so one request for a long line
    // keeps the renderer waiting about as long as the line plays. Each
    // part is its own request, fetched in parallel, and MP3 frames join
    // byte for byte.
    async speak(text: string): Promise<Uint8Array | null> {
      const parts = speechChunks(text);
      if (!parts.length) return null;
      const audio: (Uint8Array | null)[] = [];
      let next = 0;
      let failed = false;
      const worker = async () => {
        while (!failed && next < parts.length) {
          const i = next++;
          audio[i] = await speakSentence(parts[i]);
          if (!audio[i]) failed = true;
        }
      };
      await Promise.all(
        Array.from({ length: Math.min(PARALLEL, parts.length) }, worker),
      );
      // One voice per line: a missing sentence sends the whole line to the
      // OS voice rather than switching voices mid-line.
      if (failed) return null;
      return new Uint8Array(Buffer.concat(audio as Uint8Array[]));
    },
  };
}

export type EdgeTts = ReturnType<typeof createEdgeTts>;
