import { describe, it, expect } from "vitest";
import { configureModelEnv } from "../../src/renderer/voice/model-env";

// configureModelEnv is the one testable piece of the voice model path. The
// worker that calls it and voice-tracker.ts around it are the
// whisper/microphone/AudioContext boundary, untested by design the same way
// hand-tracker.ts is.

// The defaults transformers.js hands a browser: remote allowed, local denied.
// The test starts from these — seeding allowLocalModels:true would pass
// against code that never sets it.
const browserEnv = () =>
  ({
    allowRemoteModels: true,
    allowLocalModels: false,
    useBrowserCache: true,
    localModelPath: "/models/",
    backends: { onnx: { wasm: { wasmPaths: "", proxy: false } } },
  }) as unknown as Parameters<typeof configureModelEnv>[0];

describe("configureModelEnv", () => {
  it("enables local models, which a browser defaults to false", () => {
    const env = browserEnv();
    configureModelEnv(env);
    expect(env.allowLocalModels).toBe(true);
  });

  // Cache Storage is read before the network, so a stale entry replays with no
  // request at all. These files come off local disk already.
  it("turns off the browser cache, which can only go stale here", () => {
    const env = browserEnv();
    configureModelEnv(env);
    expect(env.useBrowserCache).toBe(false);
  });

  it("leaves remote models off, so the CSP is never hit at runtime", () => {
    const env = browserEnv();
    configureModelEnv(env);
    expect(env.allowRemoteModels).toBe(false);
  });

  it("never leaves both loaders disabled", () => {
    const env = browserEnv();
    configureModelEnv(env);
    expect(env.allowLocalModels || env.allowRemoteModels).toBe(true);
  });

  it("serves the model files from public/voice, which fetch can reach", () => {
    const env = browserEnv();
    configureModelEnv(env);
    expect(env.localModelPath).toBe("/voice/models");
  });

  // A directory prefix makes ORT dynamic-import its .mjs loader from that
  // prefix too, and Vite refuses to resolve an import under public/. The
  // default ORT build inlines that loader, so naming the binary is enough.
  it("names the wasm file, not a directory prefix", () => {
    const env = browserEnv();
    configureModelEnv(env);
    const paths = env.backends.onnx.wasm!.wasmPaths;
    expect(typeof paths).toBe("object");
    expect((paths as { wasm: string }).wasm).toMatch(/\.wasm$/);
  });

  // ORT runs the model on the calling thread, and that thread is asr-worker's
  // own. Its proxy would nest a second worker inside this one and copy every
  // tensor across the extra hop; the window is off this thread either way.
  it("leaves ORT on the calling thread, which is already a worker", () => {
    const env = browserEnv();
    configureModelEnv(env);
    expect(env.backends.onnx.wasm!.proxy).toBe(false);
  });

  it("asks for no .mjs, which is what Vite would refuse to serve", () => {
    const env = browserEnv();
    configureModelEnv(env);
    expect(env.backends.onnx.wasm!.wasmPaths).not.toHaveProperty("mjs");
  });
});
