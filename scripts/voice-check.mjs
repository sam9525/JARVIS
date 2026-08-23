// Run the renderer's own whisper model over a WAV file, outside Electron.
//
// Diagnostic, not part of the build: it answers one question, whether a bad
// transcript comes from the model or from how the renderer calls it. Save the
// exact buffer whisper read with `window.__voice.save()` in devtools, then:
//
//   node scripts/voice-check.mjs ~/Downloads/utterance.wav
import { readFile } from "node:fs/promises";
import { env, pipeline } from "@huggingface/transformers";
import { WHISPER_MODEL, WHISPER_DTYPE } from "../src/shared/voice-model.mjs";

const file = process.argv[2];
if (!file) throw new Error("usage: node scripts/voice-check.mjs <file.wav>");

// The same weights the renderer serves, read off disk instead of over http.
env.allowRemoteModels = false;
env.allowLocalModels = true;
env.localModelPath = "public/voice/models";

/** 16-bit PCM mono, which is what `__voice.save()` writes. Offset 44 is the
 * end of the canonical WAV header that same function emits. */
function decode(buf) {
  const rate = buf.readUInt32LE(24);
  const bits = buf.readUInt16LE(34);
  if (bits !== 16) throw new Error(`expected 16-bit samples, got ${bits}`);
  const count = (buf.length - 44) / 2;
  const out = new Float32Array(count);
  for (let i = 0; i < count; i++) out[i] = buf.readInt16LE(44 + i * 2) / 0x8000;
  return { audio: out, rate };
}

const { audio, rate } = decode(await readFile(file));
console.log(
  `${file}: ${(audio.length / rate).toFixed(2)}s at ${rate} Hz, ${WHISPER_MODEL}`,
);

const asr = await pipeline("automatic-speech-recognition", WHISPER_MODEL, {
  dtype: WHISPER_DTYPE,
});

// The same call the renderer makes, so a mismatch between this output and
// what the app showed is a renderer fault and nothing else.
const started = Date.now();
const { text } = await asr(audio, { language: "en", task: "transcribe" });
console.log(`${Date.now() - started}ms`, JSON.stringify(text));
