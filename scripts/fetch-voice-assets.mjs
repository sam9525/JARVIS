// One-time build step. The renderer's CSP is default-src 'self', so the model
// and the ONNX WASM runtime cannot be fetched at runtime the way
// transformers.js defaults to. Same reason public/hands/ exists.
import { mkdir, writeFile, readdir, copyFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const REPO = "onnx-community/whisper-tiny.en";
const MODEL_OUT = "public/voice/models/whisper-tiny.en";
const WASM_OUT = "public/voice/wasm";
const WASM_SRC = "node_modules/onnxruntime-web/dist";

// q8 keeps the download near 75 MB; fp32 is roughly four times that for no
// gain on a wake word and a short command.
const KEEP =
  /^(config|generation_config|preprocessor_config|tokenizer|tokenizer_config)\.json$|^onnx\/(encoder_model|decoder_model_merged)_quantized\.onnx$/;

const listing = await fetch(`https://huggingface.co/api/models/${REPO}`);
if (!listing.ok) throw new Error(`HF listing failed: ${listing.status}`);
const files = (await listing.json()).siblings
  .map((s) => s.rfilename)
  .filter((f) => KEEP.test(f));
if (files.length !== 7)
  throw new Error(
    `expected 7 files, matched ${files.length}: ${files.join(", ")}`,
  );

for (const f of files) {
  const r = await fetch(`https://huggingface.co/${REPO}/resolve/main/${f}`);
  if (!r.ok) throw new Error(`${f}: ${r.status}`);
  const dest = join(MODEL_OUT, f);
  await mkdir(dirname(dest), { recursive: true });
  await writeFile(dest, Buffer.from(await r.arrayBuffer()));
  console.log("saved", dest);
}

await mkdir(WASM_OUT, { recursive: true });
const runtime = (await readdir(WASM_SRC)).filter(
  (f) => f.endsWith(".wasm") || f.endsWith(".mjs"),
);
if (runtime.length === 0) throw new Error(`no runtime files in ${WASM_SRC}`);
for (const f of runtime) {
  await copyFile(join(WASM_SRC, f), join(WASM_OUT, f));
  console.log("copied", f);
}
