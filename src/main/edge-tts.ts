// Microsoft's Edge read-aloud voice: the tier between ElevenLabs and the OS
// voice, because it has no quota to spend. Pure over an injected client, so
// tests need no network. Answers null for every failure, like tts.ts.

/** The one voice this tier speaks with. A fallback needs a voice, not a menu. */
export const EDGE_VOICE = "en-US-AvaMultilingualNeural";
// MP3, because the renderer wraps the bytes as audio/mpeg.
const FORMAT = "audio-24khz-48kbitrate-mono-mp3";
const TIMEOUT_MS = 8000;
// Eight sentences take about 4.8 s over 2 sockets, 2.4 s over 4 and 1.5 s
// over 8. 4 keeps a 500-char line under 3 s without a socket per sentence.
const PARALLEL = 4;

// A stop counts only before a space or the end, so "2.1.1" stays whole.
const sentences = (text: string): string[] =>
  (text.match(/[\s\S]*?[.!?]+(?=\s|$)|[\s\S]+$/g) ?? [])
    .map((s) => s.trim())
    .filter(Boolean);

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
    try {
      const c = (client = new deps.Client());
      const collect = async () => {
        await c.setMetadata(EDGE_VOICE, FORMAT);
        const chunks: Buffer[] = [];
        for await (const chunk of c.toStream(text).audioStream) {
          chunks.push(Buffer.from(chunk as Buffer));
        }
        return new Uint8Array(Buffer.concat(chunks));
      };
      const timeout = new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), TIMEOUT_MS);
      });
      // The loser of the race still settles later; its catch keeps a late
      // stream error from surfacing as an unhandled rejection.
      const bytes = await Promise.race([collect().catch(() => null), timeout]);
      return bytes?.length ? bytes : null;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
      client?.close();
    }
  }

  return {
    // Edge sends audio at about real time, so one request for a long line
    // outlasts TIMEOUT_MS. Each sentence is its own request under its own
    // cap, and MP3 frames join byte for byte.
    async speak(text: string): Promise<Uint8Array | null> {
      const parts = sentences(text);
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
