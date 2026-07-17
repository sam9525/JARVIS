// usage: node src/hook/install.mjs <vault-path>
// Merges the JARVIS forwarding hooks into <vault>/.claude/settings.json.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mergeHooks } from "./merge.mjs";

const vault = process.argv[2];
if (!vault) {
  console.error("usage: node src/hook/install.mjs <vault-path>");
  process.exit(1);
}
if (!existsSync(vault)) {
  console.error(`vault directory not found: ${vault}`);
  process.exit(1);
}

const forward = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "forward.mjs",
);
const command = `node "${forward}"`;

const settingsPath = path.join(vault, ".claude", "settings.json");
mkdirSync(path.dirname(settingsPath), { recursive: true });
let settings = {};
if (existsSync(settingsPath)) {
  try {
    settings = JSON.parse(readFileSync(settingsPath, "utf8"));
  } catch {
    console.error(
      `could not parse ${settingsPath} — fix or remove it, nothing was changed`,
    );
    process.exit(1);
  }
}
settings = mergeHooks(settings, command);
writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
console.log(`hooks installed -> ${settingsPath}`);
