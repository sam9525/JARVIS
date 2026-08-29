// One-time build step. The renderer's CSP is default-src 'self', so the model
// and the ONNX WASM runtime cannot be fetched at runtime the way
// transformers.js defaults to. Same reason public/hands/ exists.
import { mkdir, writeFile, readdir, copyFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { WHISPER_MODEL, WHISPER_DTYPE } from "../src/shared/voice-model.mjs";

const REPO = `onnx-community/${WHISPER_MODEL}`;
const MODEL_OUT = `public/voice/models/${WHISPER_MODEL}`;
const WASM_OUT = "public/voice/wasm";
const WASM_SRC = "node_modules/onnxruntime-web/dist";

// The two weights the pipeline asks for, named by WHISPER_DTYPE so the files
// fetched here and the `dtype` the renderer passes cannot disagree. The other
// precisions in the repo are not downloaded because nothing loads them.
const WEIGHTS = Object.entries(WHISPER_DTYPE).map(
  ([model, dtype]) => `onnx/${model}_${dtype}.onnx`,
);

// The files the pipeline cannot start without.
const REQUIRED = [
  "config.json",
  "tokenizer.json",
  "tokenizer_config.json",
  "preprocessor_config.json",
  ...WEIGHTS,
];

// All metadata, not a hand-picked subset: transformers.js probes optional
// tokenizer files (special_tokens_map.json, normalizer.json, added_tokens.json,
// vocab.json, merges.txt) at load time. Shipping every one keeps the pipeline
// off the server's miss behaviour — a 404 it tolerates, an index.html body it
// parses as JSON and throws on. The metadata is a few MB in total.
const keep = (f) => /^[^/]+\.(json|txt)$/.test(f) || WEIGHTS.includes(f);

const listing = await fetch(`https://huggingface.co/api/models/${REPO}`);
if (!listing.ok) throw new Error(`HF listing failed: ${listing.status}`);
const files = (await listing.json()).siblings
  .map((s) => s.rfilename)
  .filter(keep);
const missing = REQUIRED.filter((f) => !files.includes(f));
if (missing.length) throw new Error(`${REPO} is missing ${missing.join(", ")}`);

for (const f of files) {
  const r = await fetch(`https://huggingface.co/${REPO}/resolve/main/${f}`);
  if (!r.ok) throw new Error(`${f}: ${r.status}`);
  const dest = join(MODEL_OUT, f);
  await mkdir(dirname(dest), { recursive: true });
  await writeFile(dest, Buffer.from(await r.arrayBuffer()));
  console.log("saved", dest);
}

// The only runtime file the renderer fetches; voice-tracker.ts names this exact
// file in wasmPaths. ORT's default build inlines its .mjs loader, so the other
// ~19 variants in dist/ (50 MB) are never requested.
const ORT_WASM = "ort-wasm-simd-threaded.jsep.wasm";
await mkdir(WASM_OUT, { recursive: true });
if (!(await readdir(WASM_SRC)).includes(ORT_WASM))
  throw new Error(`${ORT_WASM} missing from ${WASM_SRC}`);
await copyFile(join(WASM_SRC, ORT_WASM), join(WASM_OUT, ORT_WASM));
console.log("copied", ORT_WASM);

// The face landmarker, for finding the mouth on a head model that ships no rig.
// Same reason the whisper weights are fetched here: default-src 'self' forbids
// the CDN fetch, so the file has to be on the app origin before it is asked for.
const FACE_URL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";
const faceRes = await fetch(FACE_URL);
if (!faceRes.ok) throw new Error(`face_landmarker: ${faceRes.status}`);
await mkdir("public/voice", { recursive: true });
await writeFile(
  "public/voice/face_landmarker.task",
  Buffer.from(await faceRes.arrayBuffer()),
);
console.log("saved public/voice/face_landmarker.task");
