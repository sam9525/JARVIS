// Claude Code hook forwarder: pipes the hook's stdin JSON to the X-Ray listener.
// Prints the listener's reply body, when there is one, as the hook output (an
// automatic answer). Must always exit 0 and fast — a failing/slow hook would
// block Claude Code.
const PORT = process.env.JARVIS_PORT ?? 4599;

let body = "";
process.stdin.setEncoding("utf8");
for await (const chunk of process.stdin) body += chunk;

// The PTY's JARVIS_SESSION names the app session; Claude's own session_id
// changes on /clear, so the app cannot tell sessions apart without this.
if (process.env.JARVIS_SESSION) {
  try {
    body = JSON.stringify({
      ...JSON.parse(body),
      jarvis_session: process.env.JARVIS_SESSION,
    });
  } catch {
    // not JSON — forward it untouched
  }
}

let reply = "";
try {
  const res = await fetch(`http://127.0.0.1:${PORT}/event`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
    signal: AbortSignal.timeout(1500),
  });
  reply = await res.text();
} catch {
  // app not running — fine, hooks must never break Claude Code
}
// the write callback runs once the pipe has taken the bytes; exiting before
// it can drop them on Windows
if (reply) process.stdout.write(reply, () => process.exit(0));
else process.exit(0);
