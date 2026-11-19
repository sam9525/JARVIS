// Antigravity hook recorder: writes each hook's stdin body, unchanged, to
// `<n>-<hookEventName>.json` in the folder given as the first argument. For a
// Stop it also writes the transcript's last lines to `<n>-Stop.tail.jsonl`,
// which shows what the file holds at the moment the hook runs.
// Prints nothing and always exits 0, so it never changes what agy does.
// Usage: node scripts/record-antigravity-hooks.mjs <out dir>
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const outDir = process.argv[2];
const TAIL_LINES = 4;

let body = "";
process.stdin.setEncoding("utf8");
for await (const chunk of process.stdin) body += chunk;

let eventName = "unknown";
let transcriptPath;
try {
  const parsed = JSON.parse(body);
  eventName = parsed.hookEventName ?? "unknown";
  transcriptPath = parsed.transcriptPath;
} catch {
  // not JSON — still recorded, under "unknown"
}

try {
  mkdirSync(outDir, { recursive: true });
  const lastNumber = Math.max(
    0,
    ...readdirSync(outDir).map((name) => parseInt(name, 10) || 0),
  );
  // Hooks can run at the same time; the "wx" flag refuses a taken file name,
  // so two bodies never overwrite each other.
  for (let n = lastNumber + 1; ; n++) {
    try {
      writeFileSync(join(outDir, `${n}-${eventName}.json`), body, {
        flag: "wx",
      });
      if (eventName === "Stop" && typeof transcriptPath === "string") {
        const lines = readFileSync(transcriptPath, "utf8")
          .trimEnd()
          .split("\n");
        writeFileSync(
          join(outDir, `${n}-Stop.tail.jsonl`),
          lines.slice(-TAIL_LINES).join("\n") + "\n",
        );
      }
      break;
    } catch (err) {
      if (err.code !== "EEXIST") throw err;
    }
  }
} catch {
  // a recorder must never break the agent it watches
}
process.exit(0);
