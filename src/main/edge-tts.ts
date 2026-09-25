// Microsoft's Edge read-aloud voice: the tier between ElevenLabs and the OS
// voice, because it has no quota to spend. Pure over an injected client, so
// tests need no network. Answers null for every failure, like tts.ts.

/** The one voice this tier speaks with. A fallback needs a voice, not a menu. */
export const EDGE_VOICE = "en-US-AvaMultilingualNeural";
// MP3, because the renderer wraps the bytes as audio/mpeg.
const FORMAT = "audio-24khz-48kbitrate-mono-mp3";
const TIMEOUT_MS = 8000;

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
  return {
    // A client per call: the socket idles out between utterances, and a
    // reconnect-on-stale path costs more than a handshake saves.
    async speak(text: string): Promise<Uint8Array | null> {
      if (!text) return null;
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
        const bytes = await Promise.race([
          collect().catch(() => null),
          timeout,
        ]);
        return bytes?.length ? bytes : null;
      } catch {
        return null;
      } finally {
        clearTimeout(timer);
        client?.close();
      }
    },
  };
}

export type EdgeTts = ReturnType<typeof createEdgeTts>;
