// Claude Code status line wrapper: forwards the status JSON to the X-Ray
// listener, then prints the user's own status line command unchanged.
// Must always exit 0 and fast — a failing status line only blanks the bar.
import { spawnSync } from "node:child_process";

const PORT = process.env.JARVIS_PORT ?? 4599;

let body = "";
process.stdin.setEncoding("utf8");
for await (const chunk of process.stdin) body += chunk;

try {
  const payload = JSON.stringify({
    ...JSON.parse(body),
    jarvis_session: process.env.JARVIS_SESSION,
  });
  await fetch(`http://127.0.0.1:${PORT}/statusline`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: payload,
    signal: AbortSignal.timeout(500),
  });
} catch {
  // app not running or body not JSON — the user's line still renders
}

const userCommand = process.env.JARVIS_STATUSLINE;
if (userCommand) {
  const run = spawnSync(userCommand, {
    input: body,
    shell: true,
    timeout: 3000,
    encoding: "utf8",
    windowsHide: true,
  });
  if (run.status === 0 && run.stdout) process.stdout.write(run.stdout);
}
process.exit(0);
