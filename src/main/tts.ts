// ElevenLabs, called from main so the API key never enters the window and the
// renderer's CSP needs no external host. Pure over an injected fetch.
const BASE = "https://api.elevenlabs.io/v1";
const TIMEOUT_MS = 8000;

export interface TtsDeps {
  fetch: typeof globalThis.fetch;
}
export interface TtsConfig {
  apiKey: string;
  voiceId: string;
  modelId: string;
}
export interface TtsOption {
  id: string;
  name: string;
  /** A voice this account owns (cloned, generated, professional) rather than
   * one of ElevenLabs' premade ones. Absent on models. */
  mine?: boolean;
}

// No key, a revoked key (401) and a spent quota (429) are one outcome to the
// caller: fall back to the local mouth.
export function createTts(deps: TtsDeps) {
  const call = (path: string, apiKey: string, init?: RequestInit) =>
    deps.fetch(`${BASE}${path}`, {
      ...init,
      headers: { ...(init?.headers ?? {}), "xi-api-key": apiKey },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

  const list = async (
    path: string,
    apiKey: string,
    pick: (body: unknown) => unknown,
    idKey: string,
    extra?: (row: Record<string, unknown>) => Partial<TtsOption>,
  ): Promise<TtsOption[]> => {
    if (!apiKey) return [];
    try {
      const res = await call(path, apiKey);
      if (!res.ok) return [];
      const rows = pick(await res.json());
      if (!Array.isArray(rows)) return [];
      return rows
        .map((r) => r as Record<string, unknown>)
        .filter(
          (r) => typeof r?.[idKey] === "string" && typeof r?.name === "string",
        )
        .map((r) => ({
          id: String(r[idKey]),
          name: String(r.name),
          ...extra?.(r),
        }));
    } catch {
      return [];
    }
  };

  return {
    async speak(cfg: TtsConfig, text: string): Promise<Uint8Array | null> {
      if (!cfg.apiKey || !cfg.voiceId || !text) return null;
      try {
        const res = await call(
          `/text-to-speech/${encodeURIComponent(cfg.voiceId)}?output_format=mp3_44100_128`,
          cfg.apiKey,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ text, model_id: cfg.modelId }),
          },
        );
        if (!res.ok) return null;
        return new Uint8Array(await res.arrayBuffer());
      } catch {
        return null;
      }
    },

    // is_owner, not category: a voice copied from the Voice Library is
    // "professional" and sits in the account's list, but it is not the
    // account's — only a voice it created reads as its own. Those sort first,
    // being the reason someone opens this list.
    async voices(apiKey: string): Promise<TtsOption[]> {
      const rows = await list(
        "/voices",
        apiKey,
        (b) => (b as { voices?: unknown })?.voices ?? [],
        "voice_id",
        (r) => ({ mine: r.is_owner === true }),
      );
      return [...rows.filter((v) => v.mine), ...rows.filter((v) => !v.mine)];
    },

    models(apiKey: string): Promise<TtsOption[]> {
      return list("/models", apiKey, (b) => b, "model_id");
    },
  };
}

export type Tts = ReturnType<typeof createTts>;
