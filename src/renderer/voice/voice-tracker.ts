// Effectful boundary: microphone + whisper (ONNX/WASM) → transcribed
// utterances. Deliberately not unit tested, matching hand-tracker.ts and the
// PTY/CLI boundaries — every rule with a threshold in it lives in segment.ts,
// which is.
import { Segmenter, SAMPLE_RATE, RMS_ON } from "./segment";
import { WHISPER_MODEL } from "../../shared/voice-model.mjs";
import type { AsrReply, AsrRequest } from "./asr-worker";
// A URL, not an import: the browser fetches and compiles a worklet module
// itself. `new URL(..., import.meta.url)` is the form Vite always emits as a
// real file — `?url` inlines anything under 4 KB as a data: URL, which the
// CSP's script-src has no business allowing.
const CAPTURE_WORKLET_URL = new URL("./capture-worklet.js", import.meta.url)
  .href;

export type VoiceChunk = { text: string };

export async function startVoiceTracker(
  onUtterance: (c: VoiceChunk) => void,
  onSpeaking: (active: boolean) => void,
  deviceId?: string,
): Promise<() => void> {
  if (!navigator.mediaDevices?.getUserMedia)
    throw new Error("No microphone available");

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
  const baseAudio = {
    channelCount: 1,
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  } as const;

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: deviceId
        ? { ...baseAudio, deviceId: { exact: deviceId } }
        : baseAudio,
    });
  } catch {
    // no saved device to fall back from — this is a plain permission/hardware
    // failure on whatever the OS calls default
    if (!deviceId) throw new Error("Microphone permission denied");
    try {
      // a saved id that is no longer plugged in throws OverconstrainedError
      // here, not a permission error — retry once on the OS default, so an
      // unplugged device is unselectable rather than an error the user has
      // to clear
      stream = await navigator.mediaDevices.getUserMedia({ audio: baseAudio });
    } catch {
      // the specific device AND the OS default both failed to open — a
      // genuine permission/hardware problem, not the chosen device being gone
      throw new Error("Microphone unavailable");
    }
  }

  // The model lives in asr-worker.ts. Whisper is seconds of solid compute per
  // utterance, and transformers.js runs it on the calling thread — called from
  // here that is the window, which stops painting until the sentence is
  // transcribed. `new URL(..., import.meta.url)` is the form Vite emits as a
  // real same-origin file, which is all the CSP's default-src 'self' allows.
  const worker = new Worker(new URL("./asr-worker.ts", import.meta.url), {
    type: "module",
  });
  // Depth is one in `run` below, but each reply is matched to its request by
  // id anyway: a late answer to an abandoned utterance must never resolve the
  // one waiting now.
  let nextId = 1;
  const waiting = new Map<
    number,
    { resolve: (r: AsrReply) => void; reject: (e: Error) => void }
  >();
  worker.onmessage = (e: MessageEvent<AsrReply>) => {
    const seat = waiting.get(e.data.id);
    if (!seat) return;
    waiting.delete(e.data.id);
    if ("error" in e.data) seat.reject(new Error(e.data.error));
    else seat.resolve(e.data);
  };
  const ask = (msg: Omit<AsrRequest, "id">) =>
    new Promise<AsrReply>((resolve, reject) => {
      const id = nextId++;
      waiting.set(id, { resolve, reject });
      worker.postMessage({ ...msg, id } as AsrRequest);
    });

  // which backend actually loaded, reported in the debug object below
  let device: "webgpu" | "wasm" = "wasm";
  try {
    // The handshake waits for the model, so a failed load is a failed start
    // rather than a microphone that hears nothing.
    const hello = await ask({ ping: true });
    if ("device" in hello) device = hello.device;
  } catch (e) {
    worker.terminate();
    stream.getTracks().forEach((t) => t.stop());
    // Keep the cause: the library names the specific failure (loader disabled,
    // asset 404, unsupported dtype). vite.renderer.config.ts sets appType
    // "mpa", so a missing asset reaches here as a 404 rather than as a JSON
    // parse error on an index.html body.
    const why = e instanceof Error ? e.message : String(e);
    throw new Error(`Voice model failed to load — ${why}`);
  }

  const transcribe = async (a: Float32Array) => {
    const out = await ask({ audio: a });
    return { text: "text" in out ? out.text : "" };
  };

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
      // terminate, not dispose: the session lives in the worker, and killing
      // the thread frees it whatever state it is in
      worker.terminate();
      stream.getTracks().forEach((t) => t.stop());
    };
  } catch (e) {
    // nothing has been returned yet, so a throw here would strand a live
    // microphone with no stop handle — tear down before rethrowing
    if (ctx) void ctx.close();
    worker.terminate();
    stream.getTracks().forEach((t) => t.stop());
    throw e instanceof RangeError ? e : new Error("Microphone failed to start");
  }
}
