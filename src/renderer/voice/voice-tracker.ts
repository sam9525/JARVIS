// Effectful boundary: microphone + whisper (ONNX/WASM) → transcribed
// utterances. Deliberately not unit tested, matching hand-tracker.ts and the
// PTY/CLI boundaries — every rule with a threshold in it lives in segment.ts,
// which is.
import { env, pipeline } from "@huggingface/transformers";
import { Segmenter, SAMPLE_RATE } from "./segment";

// Local assets (Task 4): the CSP's default-src 'self' forbids the CDN fetch
// transformers.js defaults to. Same shape as hand-tracker's WASM_DIR.
env.allowRemoteModels = false;
env.localModelPath = "/voice/models";
env.backends.onnx.wasm.wasmPaths = "/voice/wasm/";

const BLOCK = 4096;

export type VoiceChunk = { text: string };

export async function startVoiceTracker(
  onUtterance: (c: VoiceChunk) => void,
  onSpeaking: (active: boolean) => void,
): Promise<() => void> {
  if (!navigator.mediaDevices?.getUserMedia)
    throw new Error("No microphone available");

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      // echoCancellation matters here specifically: the app speaks through the
      // same machine's speakers, and without it the mouth feeds the ears
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
      },
    });
  } catch {
    throw new Error("Microphone permission denied");
  }

  let transcribe: (a: Float32Array) => Promise<{ text?: string }>;
  try {
    const asr = await pipeline(
      "automatic-speech-recognition",
      "whisper-tiny.en",
      { dtype: "q8" },
    );
    transcribe = (a) => asr(a) as Promise<{ text?: string }>;
  } catch {
    stream.getTracks().forEach((t) => t.stop());
    throw new Error("Voice model failed to load — run npm run voice:assets");
  }

  let ctx: AudioContext | undefined;
  try {
    ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
    const audioCtx = ctx; // narrowed const: the closure below outlives this try block
    const source = audioCtx.createMediaStreamSource(stream);
    const processor = audioCtx.createScriptProcessor(BLOCK, 1, 1);
    // ScriptProcessor only fires while connected into the graph, and the graph
    // only runs into the destination — so route through a silent gain rather
    // than playing the microphone back through the speakers.
    const mute = audioCtx.createGain();
    mute.gain.value = 0;

    const segmenter = new Segmenter();
    let busy = false;

    const run = async (audio: Float32Array) => {
      if (busy) return; // a dropped utterance beats a queue of stale ones
      busy = true;
      try {
        const out = await transcribe(audio);
        const text = (out?.text ?? "").trim();
        if (text) onUtterance({ text });
      } catch {
        // one bad window is not a session failure — the next utterance retries
      } finally {
        busy = false;
      }
    };

    processor.onaudioprocess = (e) => {
      const was = segmenter.speaking;
      // copy: Web Audio reuses the event's buffer between callbacks
      const audio = segmenter.push(new Float32Array(e.inputBuffer.getChannelData(0)));
      if (segmenter.speaking !== was) onSpeaking(segmenter.speaking);
      if (audio) void run(audio);
    };

    source.connect(processor);
    processor.connect(mute);
    mute.connect(audioCtx.destination);

    return () => {
      processor.onaudioprocess = null;
      processor.disconnect();
      mute.disconnect();
      source.disconnect();
      void audioCtx.close();
      stream.getTracks().forEach((t) => t.stop());
    };
  } catch {
    // nothing has been returned yet, so a throw here would strand a live
    // microphone with no stop handle — tear down before rethrowing
    if (ctx) void ctx.close();
    stream.getTracks().forEach((t) => t.stop());
    throw new Error("Microphone failed to start");
  }
}
