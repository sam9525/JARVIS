/// <reference lib="webworker" />
import { env, pipeline } from "@huggingface/transformers";
import { configureModelEnv } from "./model-env";
import { WHISPER_MODEL, WHISPER_DTYPE } from "../../shared/voice-model.mjs";

/**
 * Whisper, off the window's thread.
 *
 * transformers.js runs the mel-spectrogram, the tokenizer and the generation
 * loop on whichever thread calls it, and turbo is seconds of that per
 * utterance — on the renderer's own thread it holds the frame loop, so the
 * head stops turning and the graph stops drawing until the sentence is
 * transcribed. Everything about the model lives in here instead; the tracker
 * posts audio and gets text.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

export type AsrRequest =
  { id: number; audio: Float32Array } | { id: number; ping: true };
export type AsrReply =
  | { id: number; text: string }
  | { id: number; device: "webgpu" | "wasm" }
  | { id: number; error: string };

configureModelEnv(env);

let asr: any;
const device = "wasm" as const;

// WASM, not WebGPU. Turbo at q4 on WASM is roughly three seconds per
// utterance and WebGPU is about one — but the window shares that GPU with the
// force graph, the colour head and MediaPipe, and a run of the model holds it:
// measured against dev-probes, every utterance on the WebGPU path cost a
// 7-8 second main-thread stall, and the same session on WASM cost none. Three
// seconds on a thread nobody is watching beats one second with the cockpit
// frozen.
// ponytail: swap the device back to "webgpu" if the GPU ever stops being
// shared — the jsep .wasm in public/voice/wasm is already that build.
const load = async () => {
  asr = await pipeline("automatic-speech-recognition", WHISPER_MODEL, {
    device,
    // the shared .mjs is plain JS, so its string values widen past the union
    dtype: WHISPER_DTYPE as Record<string, "q4">,
  });
  return device;
};

const ready = load();

const post = (msg: AsrReply) => (self as unknown as Worker).postMessage(msg);

self.onmessage = async (e: MessageEvent<AsrRequest>) => {
  const msg = e.data;
  try {
    await ready;
    // The ping is the handshake: it reports the backend that loaded, and a
    // model that failed to load answers with its reason instead.
    if ("ping" in msg) {
      post({ id: msg.id, device });
      return;
    }
    // turbo is multilingual, so the language is stated rather than detected —
    // detection on a two-second command is a coin toss, and a wrong guess
    // returns a translation of what you said instead of a transcript.
    const out = await asr(msg.audio, { language: "en", task: "transcribe" });
    post({ id: msg.id, text: (out?.text ?? "") as string });
  } catch (err) {
    post({
      id: msg.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }
};
