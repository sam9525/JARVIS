// usage: node src/hook/install.mjs <vault-path>
// Merges the JARVIS forwarding hooks into <vault>/.claude/settings.json.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
const hook = {
  matcher: "Read|Grep|Glob|Edit|Write",
  hooks: [{ type: "command", command }],
};

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
settings.hooks ??= {};
// Any entry already pointing at forward.mjs is ours (possibly stale from an
// older checkout path or matcher) — replace it with the canonical entry.
const referencesForward = (h) =>
  Array.isArray(h?.hooks) &&
  h.hooks.some(
    (sh) =>
      typeof sh?.command === "string" && sh.command.includes("forward.mjs"),
  );
for (const event of ["PreToolUse", "PostToolUse"]) {
  const list = Array.isArray(settings.hooks[event])
    ? settings.hooks[event]
    : [];
  settings.hooks[event] = [...list.filter((h) => !referencesForward(h)), hook];
}
writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
console.log(`hooks installed -> ${settingsPath}`);