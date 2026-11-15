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
      jarvis_sent_at: Date.now(),
      ...(process.env.JARVIS_AGENT
        ? { jarvis_agent: process.env.JARVIS_AGENT }
        : {}),
    });
  } catch {
    // not JSON — forward it untouched
  }
}

// Only a PreToolUse hook output may reach Claude Code's stdout; any other
// body would be read as the hook's own output.
function isHookReply(text) {
  try {
    return JSON.parse(text)?.hookSpecificOutput?.hookEventName === "PreToolUse";
  } catch {
    return false;
  }
}

let reply = "";
let wantsReply = false;
try {
  const event = JSON.parse(body);
  wantsReply =
    event.hook_event_name === "PreToolUse" &&
    event.tool_name === "AskUserQuestion";
} catch {
  // not JSON — nothing to answer
}
try {
  const res = await fetch(`http://127.0.0.1:${PORT}/event`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
    signal: AbortSignal.timeout(1500),
  });
  const text = await res.text();
  if (process.env.JARVIS_SESSION && res.ok && wantsReply && isHookReply(text)) {
    reply = text;
  }
} catch {
  // app not running — fine, hooks must never break Claude Code
}
// the write callback runs once the pipe has taken the bytes; exiting before
// it can drop them on Windows
if (reply) process.stdout.write(reply, () => process.exit(0));
else process.exit(0);
