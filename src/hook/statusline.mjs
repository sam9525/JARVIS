// Claude Code status line wrapper: forwards the status JSON to the X-Ray
// listener, then prints the user's own status line command unchanged.
// Must always exit 0 and fast — a failing status line only blanks the bar.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const PORT = process.env.JARVIS_PORT ?? 4599;

let body = "";
process.stdin.setEncoding("utf8");
for await (const chunk of process.stdin) body += chunk;

let status = null;
try {
  status = JSON.parse(body);
} catch {
  // not JSON — nothing to forward, and the folder falls back to the process's
}

try {
  if (status === null) throw new Error("no status to forward");
  await fetch(`http://127.0.0.1:${PORT}/statusline`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      ...status,
      jarvis_session: process.env.JARVIS_SESSION,
    }),
    signal: AbortSignal.timeout(500),
  });
} catch {
  // app not running or body not JSON — the user's line still renders
}

// The wrapper's own entry is ours, so it is never the user's command.
function commandIn(file) {
  try {
    const command = JSON.parse(readFileSync(file, "utf8"))?.statusLine?.command;
    return typeof command === "string" &&
      command &&
      !command.includes("statusline.mjs")
      ? command
      : null;
  } catch {
    return null;
  }
}

// A JARVIS terminal names the user's command; a `claude` started anywhere else
// in the workspace looks it up the way the app does: project, then user.
function userCommand() {
  if (process.env.JARVIS_STATUSLINE) return process.env.JARVIS_STATUSLINE;
  const folder =
    status?.workspace?.project_dir ??
    status?.workspace?.current_dir ??
    status?.cwd ??
    process.cwd();
  return (
    commandIn(path.join(folder, ".claude", "settings.json")) ??
    commandIn(path.join(homedir(), ".claude", "settings.json"))
  );
}

const command = userCommand();
if (command) {
  const run = spawnSync(command, {
    input: body,
    shell: true,
    timeout: 3000,
    encoding: "utf8",
    windowsHide: true,
  });
  if (run.status === 0 && run.stdout) process.stdout.write(run.stdout);
}
process.exit(0);
