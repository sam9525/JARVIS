// The whisper model id, and the directory name under public/voice/models/.
//
// large-v3-turbo at q4 is 759 MB, smaller than an fp32 small.en because turbo
// keeps a 4-layer decoder. The English-only models (tiny.en, base.en,
// small.en) return fluent, confident, unrelated English on accented speech,
// and neither beam search nor high-pass filtering changes that — accent
// robustness lives in the large-v3 encoder.
//
// Multilingual, so voice-tracker.ts must pass `language` and `task`.
//
// Plain .mjs because the two readers do not share a runtime:
// scripts/fetch-voice-assets.mjs runs under bare `node`, voice-tracker.ts is
// bundled by Vite. (src/hook/ keeps .mjs inside src/ for the same reason.)
// One constant, so what the script downloads and what the renderer asks for
// cannot drift.
export const WHISPER_MODEL = "whisper-large-v3-turbo";

// The weight files the pipeline loads, shared with the fetch script so the
// `dtype` the renderer asks for and the files on disk cannot drift apart.
export const WHISPER_DTYPE = {
  encoder_model: "q4",
  decoder_model_merged: "q4",
};
