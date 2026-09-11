import type { env as ModelEnvValue } from "@huggingface/transformers";

type ModelEnv = typeof ModelEnvValue;

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
 * Called from asr-worker.ts, which is where the pipeline lives. */
export function configureModelEnv(env: ModelEnv): void {
  env.allowRemoteModels = false;
  env.allowLocalModels = true;
  // Cache Storage is read before the network (hub.js:442), so a stale entry
  // replays with no request at all. These files come off local disk already.
  // the cost is that a mic off→on cycle re-reads and re-initialises the whole
  // model from disk — seconds, not milliseconds
  env.useBrowserCache = false;
  env.localModelPath = "/voice/models";
  const wasm = env.backends.onnx.wasm!; // always present in the browser build
  wasm.wasmPaths = { wasm: ORT_WASM_URL };
  // ORT runs the model on whatever thread calls it, and that thread is already
  // a worker of our own. Its proxy would nest a second worker inside this one
  // and copy every tensor across the extra hop, buying nothing: the window is
  // off this thread either way.
  wasm.proxy = false;
}
