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
      "The target must already have a live session.\n\n" +
      "Working a to-do task: when the user asks you to do an open @project task from\n" +
      "TODO.md, launch the workspace if it has no session, then send with\n" +
      "fresh: true and this prompt, with the task line copied in verbatim. Use\n" +
      "fresh: true for any new or unrelated task; never for a follow-up on the same\n" +
      "task. If fresh is refused as busy, tell the user and ask what to do.\n\n" +
      "To-do task: <task text, verbatim from TODO.md>\n\n" +
      "Run this pipeline. Stop at each gate and wait for my answer.\n" +
      "1. Use superpowers:brainstorming to write a spec for this task.\n" +
      '2. Gate: ask me with AskUserQuestion, header "Spec", options\n' +
      '   "Approve" and "Review in browser". "Review in browser" means run\n' +
      "   interactive-html-review on the spec, then ask this gate again.\n" +
      "   Typed feedback means revise the spec, then ask this gate again.\n" +
      '3. On "Approve", use superpowers:writing-plans to write the plan.\n' +
      '4. Gate: the same question with header "Plan", for the plan.\n' +
      '5. On "Approve", use superpowers:subagent-driven-development to build it.\n' +
      "   When the build is done, end your last message with a short list of\n" +
      "   what I should check by hand.\n\n" +
      "Working several to-do tasks: when the user asks for all open tasks of one\n" +
      "@project, or several of them, send them in ONE jarvis_send with fresh: true\n" +
      "and the prompt below, each task line copied in verbatim.\n" +
      "Use the single-task prompt when only one task is chosen.\n" +
      "Tasks for different projects never share a prompt.\n\n" +
      "To-do tasks:\n" +
      "<task line 1, verbatim from TODO.md>\n" +
      "<task line 2, verbatim from TODO.md>\n\n" +
      "Run this pipeline. Stop at each gate and wait for my answer.\n" +
      "1. Use superpowers:brainstorming to decide if these tasks fit one spec.\n" +
      "   If they do, write one spec for all of them. If not, tell me which tasks\n" +
      "   go in which spec, then write only the first spec.\n" +
      '2. Gate: ask me with AskUserQuestion, header "Spec", options\n' +
      '   "Approve" and "Review in browser". "Review in browser" means run\n' +
      "   interactive-html-review on the spec, then ask this gate again.\n" +
      "   Typed feedback means revise the spec, then ask this gate again.\n" +
      '3. On "Approve", write the next spec and repeat step 2, until every\n' +
      "   spec is approved. Never start a spec before the one before it is approved.\n" +
      "4. Then, for each spec in order: use superpowers:writing-plans to write\n" +
      '   its plan; gate with the same question, header "Plan"; on "Approve",\n' +
      "   use superpowers:subagent-driven-development to build it. When the build\n" +
      "   is done, end your last message with a short list of what I should check\n" +
      "   by hand.\n\n" +
      "After a to-do send succeeds, mark each sent task line - [/] in TODO.md\n" +
      'with Edit, then call jarvis_todos and fix anything in malformed. "All\n' +
      'open tasks" means the - [ ] lines only; never send a - [/] line as part\n' +
      "of them. A working task the user names on its own is sent as usual and\n" +
      "stays - [/].\n" +
      "End your turn with one sentence naming the workspace and the task,\n" +
      'such as "Told JARVIS to add the Working section." Say nothing about\n' +
      "gates, approval, what the session will do, or what you will check later. " +
      "That one sentence replaces the next-open-task sentence.",
    inputSchema: {
      type: "object",
      properties: {
        workspace: {
          type: "string",
          description: "Target workspace name, as shown by jarvis_list",
        },
        prompt: { type: "string", description: "The prompt to submit" },
        fresh: {
          type: "boolean",
          description:
            "true to clear the workspace's session with /clear first. Refused while it is working, asking or blocked. The user's unsent draft in that terminal breaks the clear.",
        },
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
      "'- [ ] text @project YYYY-MM-DD'; '- [/]' while a workspace is working on it; " +
      "'- [x]' when done; no @ for a " +
      "personal task; @project is a workspace name from jarvis_list with " +
      "spaces written as hyphens. Write today's date on every task you add. " +
      "Call this again after each write and fix every line listed in " +
      "malformed. When the user asked about the list, say the next open task in one spoken sentence. " +
      "Check a task off (change '- [ ]' or '- [/]' to '- [x]') in the same turn the user agrees it is " +
      "done — they said so or approved the result. A workspace finish report " +
      "saying its work was merged into develop also counts, because nothing " +
      "is merged until the user tells a workspace to merge it: when it " +
      "clearly matches one open or working task (same project, same subject), check " +
      "that task off the same way and name it in your spoken summary. " +
      "A merge report that covers several tasks sent together checks off each task it clearly covers, and names each one. " +
      "If an open and a working task both match, check off the working one. " +
      "A " +
      "report that only says done, committed or tests pass is not " +
      "agreement. If the user's words or a merge report could match several " +
      "working tasks, or none clearly, ask which.",
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
      const fresh = args?.fresh === true;
      // a fresh send types /clear and waits up to 20s for the TUI to settle
      // before sending, so give it the same bound as jarvis_launch
      const out = await post(
        "/orchestrate/send",
        { workspace: args?.workspace, prompt: args?.prompt, fresh },
        fresh ? 30000 : undefined,
      );
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
