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

const forward = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "forward.mjs",
);
const hook = {
  matcher: "Read|Grep|Glob|Edit|Write",
  hooks: [{ type: "command", command: `node "${forward}"` }],
};

const settingsPath = path.join(vault, ".claude", "settings.json");
mkdirSync(path.dirname(settingsPath), { recursive: true });
const settings = existsSync(settingsPath)
  ? JSON.parse(readFileSync(settingsPath, "utf8"))
  : {};
settings.hooks ??= {};
for (const event of ["PreToolUse", "PostToolUse"]) {
  const list = (settings.hooks[event] ??= []);
  const hasHook = list.some((h) => {
    if (!h || !Array.isArray(h.hooks)) return false;
    return h.hooks.some(
      (sh) =>
        sh &&
        sh.type === "command" &&
        typeof sh.command === "string" &&
        (sh.command === `node "${forward}"` ||
          sh.command.includes("forward.mjs")),
    );
  });
  if (!hasHook) {
    list.push(hook);
  }
}
writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
console.log(`hooks installed -> ${settingsPath}`);
