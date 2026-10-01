// JARVIS orchestrator MCP server (stdio). Claude Code spawns this in the
// main-agent workspace via .mcp.json; it proxies its tools to the app's localhost
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
    name: "jarvis_launch",
    description:
      "Start a Claude Code session for a workspace on the rail that has none " +
      "(jarvis_list shows live: false), the same way its terminal's launch " +
      "button does. Returns once the session is ready for input; then " +
      "jarvis_send to it. If it says the session is asking to trust its " +
      "folder, do not jarvis_send yet: ask the user whether they trust that " +
      "folder, then call jarvis_trust with their answer. " +
      "Fails if the name is unknown or a session already exists.",
    inputSchema: {
      type: "object",
      properties: {
        workspace: {
          type: "string",
          description: "Workspace name, as shown by jarvis_list",
        },
      },
      required: ["workspace"],
    },
  },
  {
    name: "jarvis_trust",
    description:
      "Answer the folder-trust prompt of a session jarvis_launch just " +
      "started, with the user's own answer — never decide it yourself. " +
      "accept: true selects 'Yes, I trust this folder' and the session " +
      "continues, ready for jarvis_send. accept: false selects 'No, exit' and " +
      "the session closes. Fails if the folder is already trusted.",
    inputSchema: {
      type: "object",
      properties: {
        workspace: {
          type: "string",
          description: "Workspace name, as shown by jarvis_list",
        },
        accept: {
          type: "boolean",
          description: "true only if the user said they trust the folder",
        },
      },
      required: ["workspace", "accept"],
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
      "malformed. Then say the next open task in one spoken sentence. " +
      "Check a task off ('- [x]') in the same turn the user agrees it is " +
      "done — they said so or approved the result. A workspace reporting it " +
      "finished is not agreement. If the user's words could mean more than " +
      "one open task, ask which.",
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
    if (name === "jarvis_launch") {
      // installs run before the spawn and the answer waits for the new TUI to
      // go quiet (up to 20s in main), so allow well past 1.5s
      const out = await post(
        "/orchestrate/launch",
        { workspace: args?.workspace },
        30000,
      );
      if (!out?.ok) return textResult(out?.error ?? "launch failed", true);
      return textResult(
        out.trustPrompt
          ? `launched ${args?.workspace}, but its session is asking whether ` +
              `to trust the folder ${out.trustPrompt}. Ask the user if they ` +
              "trust it, then call jarvis_trust with their answer. Do not " +
              "jarvis_send to it before that."
          : `launched ${args?.workspace}`,
      );
    }
    if (name === "jarvis_trust") {
      // the answer waits for the session to settle past the prompt
      const out = await post(
        "/orchestrate/trust",
        { workspace: args?.workspace, accept: args?.accept === true },
        30000,
      );
      if (!out?.ok) return textResult(out?.error ?? "trust failed", true);
      return textResult(
        args?.accept === true
          ? `trusted ${args?.workspace}'s folder — its session is ready for jarvis_send`
          : `declined — ${args?.workspace}'s session is closing`,
      );
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
      return out?.error
        ? textResult(String(out.error), true)
        : textResult(JSON.stringify(out, null, 2));
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
