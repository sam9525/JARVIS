// Microphone capture on the audio thread. Plain .js and loaded by URL because
// an AudioWorklet module is fetched and compiled by the browser, not bundled
// into the renderer graph — the same reason src/hook/*.mjs is not TypeScript.
//
// The audio thread, not the main one: main is shared with React and the force
// graph, and a capture starved there (a ScriptProcessorNode) drops audio
// blocks that whisper hears as slurred words.
const BLOCK = 4096; // 256 ms at 16 kHz — the segmenter's resolution

class Capture extends AudioWorkletProcessor {
  buf = new Float32Array(BLOCK);
  at = 0;

  process(inputs) {
    const channel = inputs[0]?.[0];
    if (!channel) return true; // a disconnected input is not a reason to stop
    for (let i = 0; i < channel.length; i++) {
      this.buf[this.at++] = channel[i];
      if (this.at === BLOCK) {
        // postMessage structured-clones, so the buffer is safe to reuse
        this.port.postMessage(this.buf);
        this.at = 0;
      }
    }
    return true;
  }
}

registerProcessor("capture", Capture);
