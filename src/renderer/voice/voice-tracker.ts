// Effectful boundary: microphone + whisper (ONNX/WASM) → transcribed
// utterances. Deliberately not unit tested, matching hand-tracker.ts and the
// PTY/CLI boundaries — every rule with a threshold in it lives in segment.ts,
// which is.
import type { pipeline as PipelineFn } from "@huggingface/transformers";
import { Segmenter, SAMPLE_RATE, RMS_ON } from "./segment";
import { WHISPER_MODEL, WHISPER_DTYPE } from "../../shared/voice-model.mjs";
// A URL, not an import: the browser fetches and compiles a worklet module
// itself. `new URL(..., import.meta.url)` is the form Vite always emits as a
// real file — `?url` inlines anything under 4 KB as a data: URL, which the
// CSP's script-src has no business allowing.
const CAPTURE_WORKLET_URL = new URL("./capture-worklet.js", import.meta.url)
  .href;

export type VoiceChunk = { text: string };

type ModelEnv = (typeof import("@huggingface/transformers"))["env"];

// wasmPaths names this file, never the directory holding it. Given a prefix
// string, ORT also dynamic-imports its .mjs loader from that prefix, and Vite
// refuses to resolve an import of anything under public/. The default
// `ort.bundle.min.mjs` build inlines that loader, so naming the .wasm leaves
// this one fetch and no import.
const ORT_WASM_URL = "/voice/wasm/ort-wasm-simd-threaded.jsep.wasm";

/** Point transformers.js at public/voice, the only place the CSP's
 * default-src 'self' can reach.
 *
 * allowLocalModels is set explicitly because it defaults to FALSE in a browser
 * (node_modules/@huggingface/transformers/src/env.js:145) — clearing
 * allowRemoteModels alone leaves both loaders off and nothing loads.
 *
 * Exported for tests; the rest of this file is a hardware boundary. */
export function configureModelEnv(env: ModelEnv): void {
  env.allowRemoteModels = false;
  env.allowLocalModels = true;
  // Cache Storage is read before the network (hub.js:442), so a stale entry
  // replays with no request at all. These files come off local disk already.
  // the cost is that a mic off→on cycle re-reads and re-initialises the whole
  // model from disk — seconds, not milliseconds
  env.useBrowserCache = false;
  env.localModelPath = "/voice/models";
  env.backends.onnx.wasm.wasmPaths = { wasm: ORT_WASM_URL };
  // ORT runs the model on whatever thread calls it, and whisper is seconds of
  // solid wasm — on the renderer's own thread that is a frozen window, not a
  // slow one. `proxy` moves session creation and every run into ORT's own
  // worker. The worker is the ORT module itself (`import.meta.url`), so it is
  // same-origin and the CSP needs nothing added.
  env.backends.onnx.wasm.proxy = true;
}

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
      // same machine's speakers, and without it the mouth feeds the ears.
      //
      // noiseSuppression stays on too: it is tuned for a telephone call and
      // spends some consonant detail on a quiet line, which costs less than
      // the confident sentences whisper builds out of room noise.
      //
      // autoGainControl stays on because the segmenter gates on the raw
      // signal — an unamplified microphone sits under RMS_ON, so a whole
      // session captures nothing.
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
  } catch {
    throw new Error("Microphone permission denied");
  }

  // hoisted so the teardown paths below (both this function's failure catch
  // and the AudioContext block's) can dispose it — a pipeline that is only
  // ever constructed and never disposed leaks its ONNX session per mic toggle
  let asr!: Awaited<ReturnType<typeof PipelineFn>>;
  let transcribe: (a: Float32Array) => Promise<{ text?: string }>;
  // which backend actually loaded, reported in the debug object below
  let device: "webgpu" | "wasm" = "wasm";
  try {
    // Loaded here, not at module scope: importing this module must not pull
    // in @huggingface/transformers (and onnxruntime-web) on every renderer
    // startup when voice is switched off.
    const { env, pipeline } = await import("@huggingface/transformers");
    configureModelEnv(env);
    // WHISPER_MODEL is the directory name under env.localModelPath and
    // WHISPER_DTYPE names the weight files inside it. The fetch script builds
    // its download list from the same two constants, so they cannot drift.
    //
    // WebGPU first: turbo at q4 is ~760 MB, and on WASM that is roughly three
    // seconds per utterance — slower than the sentence being spoken. The jsep
    // .wasm already in public/voice/wasm IS the WebGPU build, so the GPU path
    // needs no extra asset. Falling back keeps voice working on a machine that
    // reports no adapter, at WASM speed.
    const load = (device: "webgpu" | "wasm") =>
      pipeline("automatic-speech-recognition", WHISPER_MODEL, {
        device,
        dtype: WHISPER_DTYPE,
      });
    try {
      asr = await load("webgpu");
      device = "webgpu";
    } catch {
      asr = await load("wasm");
    }
    // turbo is multilingual, so the language is stated rather than detected —
    // detection on a two-second command is a coin toss, and a wrong guess
    // returns a translation of what you said instead of a transcript.
    transcribe = (a) =>
      asr(a, { language: "en", task: "transcribe" }) as Promise<{
        text?: string;
      }>;
  } catch (e) {
    stream.getTracks().forEach((t) => t.stop());
    // Keep the cause: the library names the specific failure (loader disabled,
    // asset 404, unsupported dtype). vite.renderer.config.ts sets appType
    // "mpa", so a missing asset reaches here as a 404 rather than as a JSON
    // parse error on an index.html body.
    const why = e instanceof Error ? e.message : String(e);
    throw new Error(`Voice model failed to load — ${why}`);
  }

  let ctx: AudioContext | undefined;
  try {
    ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
    const audioCtx = ctx; // narrowed const: the closure below outlives this try block
    // The sampleRate option above is a request, not a guarantee. Whisper's
    // rate is not negotiable — running at the wrong one would silently feed
    // it sped-up or slowed-down audio with no error anywhere, presenting as
    // "it hears nothing I say".
    if (audioCtx.sampleRate !== SAMPLE_RATE)
      throw new RangeError(
        `Microphone runs at ${audioCtx.sampleRate} Hz, not ${SAMPLE_RATE}`,
      );
    const source = audioCtx.createMediaStreamSource(stream);
    await audioCtx.audioWorklet.addModule(CAPTURE_WORKLET_URL);
    const capture = new AudioWorkletNode(audioCtx, "capture");
    // A node only runs while the graph pulls it, and the graph is pulled by
    // the destination — so route through a silent gain rather than playing the
    // microphone back through the speakers.
    const mute = audioCtx.createGain();
    mute.gain.value = 0;

    const segmenter = new Segmenter(audioCtx.sampleRate);
    let busy = false;
    let pending: Float32Array | null = null;

    // Tuning window for RMS_ON, published on window rather than through React:
    // it updates once per audio block, and a re-render that often restarts the
    // force simulation. Read it in devtools with
    //   setInterval(() => console.log(window.__voice), 500)
    const debug = {
      model: WHISPER_MODEL,
      device, // "webgpu" when the GPU has it, "wasm" after the fallback
      // The microphone Chromium actually opened. getUserMedia picks the system
      // default and never says so — a headset left plugged in, or a webcam's
      // far-field array, is a different signal than the one you think you are
      // speaking into.
      mic: stream.getAudioTracks()[0]?.label ?? "unknown",
      lastMs: 0, // how long the last transcription took
      on: RMS_ON, // the live bar `level` clears for capture to start
      floor: 0, // measured room noise, which `on` scales off
      level: 0, // this block
      peak: 0, // loudest block this session
      speaking: false,
      utterances: 0, // segments handed to whisper
      heard: [] as string[], // what whisper made of them, newest last
      last: null as Float32Array | null, // the exact buffer whisper last read
      // Write that buffer out as a 16-bit WAV. Listening to it says whether
      // the audio or the model is at fault, and `node scripts/voice-check.mjs`
      // then runs the same model over the same file outside the renderer,
      // which says whether the renderer's call is at fault.
      save() {
        if (!debug.last) return "nothing captured yet — utterances is 0";
        const pcm = debug.last;
        const buf = new ArrayBuffer(44 + pcm.length * 2);
        const view = new DataView(buf);
        const tag = (at: number, s: string) => {
          for (let i = 0; i < s.length; i++)
            view.setUint8(at + i, s.charCodeAt(i));
        };
        tag(0, "RIFF");
        view.setUint32(4, 36 + pcm.length * 2, true);
        tag(8, "WAVEfmt ");
        view.setUint32(16, 16, true); // PCM header size
        view.setUint16(20, 1, true); // format: uncompressed
        view.setUint16(22, 1, true); // mono
        view.setUint32(24, SAMPLE_RATE, true);
        view.setUint32(28, SAMPLE_RATE * 2, true); // bytes per second
        view.setUint16(32, 2, true); // bytes per frame
        view.setUint16(34, 16, true); // bits per sample
        tag(36, "data");
        view.setUint32(40, pcm.length * 2, true);
        for (let i = 0; i < pcm.length; i++) {
          const s = Math.max(-1, Math.min(1, pcm[i]));
          view.setInt16(44 + i * 2, s * 0x7fff, true);
        }
        const url = URL.createObjectURL(new Blob([buf], { type: "audio/wav" }));
        const a = document.createElement("a");
        a.href = url;
        a.download = "utterance.wav";
        a.click();
        // Chromium can abort a download whose URL is revoked in the same tick
        setTimeout(() => URL.revokeObjectURL(url), 0);
        return "saved utterance.wav";
      },
    };
    // dev only, like dev-probes: debug.last pins the last utterance's audio
    // (~1 MB) and debug.mic names the device, neither of which a shipped build
    // should hold onto after the microphone is gone
    const probe = window as unknown as { __voice?: typeof debug };
    if (import.meta.env.DEV) probe.__voice = debug;

    const run = async (audio: Float32Array) => {
      // whisper is slower than speech, so a breath spoken while the previous
      // one transcribes waits its turn instead of vanishing mid-sentence.
      // Depth one: two breaths behind, the older one is already stale.
      if (busy) {
        pending = audio;
        return;
      }
      busy = true;
      let next: Float32Array | null = audio;
      while (next) {
        try {
          const started = performance.now();
          debug.last = next;
          const out = await transcribe(next);
          debug.lastMs = Math.round(performance.now() - started);
          const text = (out?.text ?? "").trim();
          debug.heard = [...debug.heard, text || "(nothing)"].slice(-5);
          if (text) onUtterance({ text });
        } catch (e) {
          // one bad window is not a session failure — the next utterance
          // retries. Recorded in `heard` so a transcriber that always throws
          // is not read as a microphone that hears nothing.
          debug.heard = [...debug.heard, `error: ${String(e)}`].slice(-5);
        }
        next = pending;
        pending = null;
      }
      busy = false;
    };

    capture.port.onmessage = (e: MessageEvent<Float32Array>) => {
      const was = segmenter.speaking;
      // no copy: postMessage structured-clones, so each message is already its
      // own buffer, which is what the Segmenter needs to hold on to
      const audio = segmenter.push(e.data);
      debug.level = segmenter.level; // computed inside push, not a second pass
      debug.floor = segmenter.floor;
      debug.on = segmenter.on;
      debug.peak = Math.max(debug.peak, debug.level);
      debug.speaking = segmenter.speaking;
      if (segmenter.speaking !== was) onSpeaking(segmenter.speaking);
      if (audio) {
        debug.utterances += 1;
        void run(audio);
      }
    };

    source.connect(capture);
    capture.connect(mute);
    mute.connect(audioCtx.destination);

    return () => {
      delete probe.__voice;
      capture.port.onmessage = null;
      capture.disconnect();
      mute.disconnect();
      source.disconnect();
      void audioCtx.close();
      void asr.dispose();
      stream.getTracks().forEach((t) => t.stop());
    };
  } catch (e) {
    // nothing has been returned yet, so a throw here would strand a live
    // microphone with no stop handle — tear down before rethrowing
    if (ctx) void ctx.close();
    void asr.dispose();
    stream.getTracks().forEach((t) => t.stop());
    throw e instanceof RangeError ? e : new Error("Microphone failed to start");
  }
}
