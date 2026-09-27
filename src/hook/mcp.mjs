// JARVIS orchestrator MCP server (stdio). Claude Code spawns this in the
// vault workspace via .mcp.json; it proxies two tools to the app's localhost
// listener and knows nothing about the app beyond two URLs. Hand-rolled
// newline-delimited JSON-RPC, same school as forward.mjs — no SDK dependency.
const PORT = process.env.JARVIS_PORT ?? 4599;
const BASE = `http://127.0.0.1:${PORT}`;

const TOOLS = [
  {
    name: "jarvis_list",
    description:
      "List every workspace in the JARVIS cockpit: name, kind (vault/code), " +
      "status (waiting/running/idle/none), current tool call, last assistant " +
      "message, whether a live Claude Code session exists, and who delegated " +
      "its current turn. Poll this after jarvis_send to watch a delegate work.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "jarvis_send",
    description:
      "Send a prompt into another workspace's live Claude Code session, as if " +
      "typed there. Returns as soon as the prompt is submitted — it does NOT " +
      "wait for the delegate to finish; poll jarvis_list to follow progress. " +
      "The target must already have a live session.",
    inputSchema: {
      type: "object",
      properties: {
        workspace: {
          type: "string",
          description: "Target workspace name, as shown by jarvis_list",
        },
        prompt: { type: "string", description: "The prompt to submit" },
      },
      required: ["workspace", "prompt"],
    },
  },
  {
    name: "jarvis_watch",
    description:
      "Block until a workspace other than this one finishes a turn, then " +
      "return { workspace, message } with that session's full last assistant " +
      "message. Returns { timeout: true } if nothing finishes in time. Call " +
      "it again after you handle an event to keep watching the fleet.",
    inputSchema: {
      type: "object",
      properties: {
        timeout_seconds: {
          type: "number",
          description: "How long to wait. Default 60, maximum 300.",
        },
      },
    },
  },
  {
    name: "jarvis_say",
    description:
      "Speak text aloud through the JARVIS cockpit's voice. For summaries " +
      "only — the text is capped at 500 characters, and a delegate's raw " +
      "output must never be passed straight in.",
    inputSchema: {
      type: "object",
      properties: {
        text: {
          type: "string",
          description: "What to say, one or two sentences",
        },
      },
      required: ["text"],
    },
  },
  {
    name: "jarvis_todos",
    description:
      "Open the user's to-do list on screen and return its file as " +
      "{ path, text, malformed }. Call this for any question about the list " +
      '("show me the todo list", "what should we do next", "what\'s on my ' +
      'list") and before adding or changing a task. Edit the file at the ' +
      "returned path with Read and Edit. One task per line: " +
      "'- [ ] text @project YYYY-MM-DD'; '- [x]' when done; no @ for a " +
      "personal task; @project is a workspace name from jarvis_list with " +
      "spaces written as hyphens. Write today's date on every task you add. " +
      "Call this again after each write and fix every line listed in " +
      "malformed. Then say the next open task in one spoken sentence.",
    inputSchema: { type: "object", properties: {} },
  },
];

async function post(path, body, timeoutMs = 1500) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-jarvis": "1" },
    body: JSON.stringify(body ?? {}),
    signal: AbortSignal.timeout(timeoutMs), // never hang the orchestrating session
  });
  return res.json();
}

const textResult = (text, isError) =>
  isError
    ? { content: [{ type: "text", text }], isError: true }
    : { content: [{ type: "text", text }] };

async function callTool(name, args) {
  try {
    if (name === "jarvis_list") {
      const fleet = await post("/orchestrate/list", {});
      return textResult(JSON.stringify(fleet, null, 2));
    }
    if (name === "jarvis_send") {
      const out = await post("/orchestrate/send", {
        workspace: args?.workspace,
        prompt: args?.prompt,
      });
      return out?.ok
        ? textResult(`sent to ${args?.workspace}`)
        : textResult(out?.error ?? "send failed", true);
    }
    if (name === "jarvis_watch") {
      const secs = Math.min(
        Math.max(Number(args?.timeout_seconds) || 60, 1),
        300,
      );
      // the app parks for the whole window, so this bound has to outlast it
      const out = await post(
        "/orchestrate/watch",
        { timeout_seconds: secs },
        secs * 1000 + 5000,
      );
      return textResult(JSON.stringify(out, null, 2));
    }
    if (name === "jarvis_say") {
      const out = await post("/orchestrate/say", { text: args?.text });
      return out?.ok
        ? textResult("spoken")
        : textResult(out?.error ?? "say failed", true);
    }
    if (name === "jarvis_todos") {
      const out = await post("/orchestrate/todos", {});
      return textResult(JSON.stringify(out, null, 2));
    }
    return textResult(`unknown tool: ${name}`, true);
  } catch {
    return textResult(
      `JARVIS app is not reachable on 127.0.0.1:${PORT} — is it running?`,
      true,
    );
  }
}

const reply = (msg) => process.stdout.write(JSON.stringify(msg) + "\n");
const respond = (id, result) => reply({ jsonrpc: "2.0", id, result });
const respondError = (id, code, message) =>
  reply({ jsonrpc: "2.0", id, error: { code, message } });

async function handle(msg) {
  if (typeof msg !== "object" || msg === null) return; // e.g. a bare string
  const { id, method, params } = msg;
  if (id === undefined || id === null) return; // notification — no response
  if (method === "initialize") {
    respond(id, {
      protocolVersion: params?.protocolVersion ?? "2025-06-18",
      capabilities: { tools: {} },
      serverInfo: { name: "jarvis", version: "1.0.0" },
    });
  } else if (method === "tools/list") {
    respond(id, { tools: TOOLS });
  } else if (method === "tools/call") {
    respond(id, await callTool(params?.name, params?.arguments));
  } else if (method === "ping") {
    respond(id, {});
  } else {
    respondError(id, -32601, `method not found: ${method}`);
  }
}

let buf = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buf += chunk;
  let nl;
  while ((nl = buf.indexOf("\n")) !== -1) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      respondError(null, -32700, "parse error");
      continue;
    }
    void handle(msg);
  }
});
process.stdin.on("end", () => process.exit(0));
