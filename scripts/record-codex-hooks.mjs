// Codex hook recorder: writes each hook's stdin body, unchanged, to
// `<n>-<hook_event_name>.json` in the folder given as the first argument.
// Prints nothing and always exits 0, so it never changes what Codex does.
// Usage: node scripts/record-codex-hooks.mjs <out dir>
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const outDir = process.argv[2];

let body = "";
process.stdin.setEncoding("utf8");
for await (const chunk of process.stdin) body += chunk;

let eventName = "unknown";
try {
  eventName = JSON.parse(body).hook_event_name ?? "unknown";
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
      break;
    } catch (err) {
      if (err.code !== "EEXIST") throw err;
    }
  }
} catch {
  // a recorder must never break the agent it watches
}
process.exit(0);
