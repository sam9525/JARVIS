// Claude Code hook forwarder: pipes the hook's stdin JSON to the X-Ray listener.
// Must always exit 0 and fast — a failing/slow hook would block Claude Code.
const PORT = process.env.JARVIS_PORT ?? 4599;

let body = "";
process.stdin.setEncoding("utf8");
for await (const chunk of process.stdin) body += chunk;

try {
  await fetch(`http://127.0.0.1:${PORT}/event`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
    signal: AbortSignal.timeout(1500),
  });
} catch {
  // app not running — fine, hooks must never break Claude Code
}
process.exit(0);