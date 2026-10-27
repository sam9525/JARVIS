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
      "List the JARVIS cockpit: one row per live session, plus one row for " +
      "each workspace that has none. A row has the workspace name, kind " +
      "(vault/code), status (waiting/running/idle/none), current tool call, " +
      "last assistant message, whether a live Claude Code session exists, who " +
      'delegated its current turn, the session label ("" when none), the ' +
      'session topic ("" when none), and the worktree folder of that session ("" when it shares the workspace ' +
      "folder). The vault workspace is the one with kind vault, never found " +
      "by name. Poll this after jarvis_send to watch a delegate work.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "jarvis_send",
    description:
      "Send a prompt into a Claude Code session of another workspace, as if " +
      "typed there. Returns as soon as the prompt is submitted — it does NOT " +
      "wait for the delegate to finish; poll jarvis_list to follow progress.\n\n" +
      'After a send, confirm it in a few words, such as "Sent to JARVIS ' +
      'main.": the user hears your reply, and the finish turn reports the ' +
      "result, so a longer reply says the same thing twice.\n\n" +
      "Without fresh, the prompt goes to the session named by session, or to " +
      "the only live one; with several live and none named it is refused and " +
      "the answer lists their labels. With fresh: true it opens a NEW session " +
      "(in its own git worktree for a code repo) and sends there, answering " +
      "{ session, worktree? }. At 4 live sessions it is refused and lists " +
      "them: ask the user which one to close, and call jarvis_close only on " +
      "their word. If the answer carries a trustPrompt, nothing was sent: ask " +
      "the user, call jarvis_trust with their answer and the session, then " +
      "send again with that session.\n\n" +
      "Working a to-do task: when the user asks you to do an open @project task from\n" +
      "TODO.md, send this prompt, with the task line copied in verbatim, as\n" +
      "routed under Routing a project task below. Pass label with every fresh send: one word that names the task, such as\n" +
      'label: "tabs". The new tab shows it at once.\n' +
      "A follow-up on what a session already did goes to that session, with its\n" +
      "session label.\n" +
      "If fresh is refused at the cap of 4 sessions, ask the user which to close.\n\n" +
      "Routing a project task: this applies to every new project task in a code\n" +
      "workspace, a single to-do, a batch, or the send after a note lookup, and\n" +
      "overrides any older guide text that says every task gets a fresh session or\n" +
      "that main belongs to the user. If the project's main tab is live and not\n" +
      'working, asking or blocked, jarvis_send with session: "main". If it is not\n' +
      'live, jarvis_launch with label: "main", then send to main (handle a trust\n' +
      "prompt as above). If it is busy, or the send is refused because the user\n" +
      "has typed text there that is not sent, jarvis_send with fresh: true and a\n" +
      "one-word label.\n" +
      "When the task relates to the main tab's current conversation, send on top\n" +
      'of it. When it is unrelated, first jarvis_send /clear to session: "main",\n' +
      "then the task. A freshly launched main tab needs no /clear.\n\n" +
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
      "   Put this in the prompt of every implementer or fix subagent:\n" +
      "   Before editing any existing function, class or method, run GitNexus\n" +
      "   impact on it and pass repo: the name list_repos gives for this\n" +
      "   project's main folder (call list_repos once). New files, tests and\n" +
      "   docs need no impact. Report each result in your summary.\n" +
      "   When the build is done, end your last message with a short list of\n" +
      "   what I should check by hand.\n\n" +
      "Working several to-do tasks: when the user asks for all open tasks of one\n" +
      "@project, or several of them, send them in ONE jarvis_send, routed as above,\n" +
      "with the prompt below, each task line copied in verbatim.\n" +
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
      "   use superpowers:subagent-driven-development to build it.\n" +
      "   Put this in the prompt of every implementer or fix subagent:\n" +
      "   Before editing any existing function, class or method, run GitNexus\n" +
      "   impact on it and pass repo: the name list_repos gives for this\n" +
      "   project's main folder (call list_repos once). New files, tests and\n" +
      "   docs need no impact. Report each result in your summary.\n" +
      "   When the build is done, end your last message with a short list of\n" +
      "   what I should check by hand.\n\n" +
      "After a to-do send succeeds, mark each sent task line - [/] in TODO.md\n" +
      'with Edit, then call jarvis_todos and fix anything in malformed. "All\n' +
      'open tasks" means the - [ ] lines only; never send a - [/] line as part\n' +
      "of them. A working task the user names on its own is sent as usual and\n" +
      "stays - [/].\n" +
      "End your turn with one sentence naming the workspace and the task,\n" +
      'such as "Told JARVIS to add the Working section." Say nothing about\n' +
      "gates, approval, what the session will do, or what you will check later. " +
      "That one sentence replaces the next-open-task sentence.\n\n" +
      "Worktree line: when the send answer has a worktree, add this line to\n" +
      "the task prompt, with <main folder> filled in:\n" +
      "You are in a git worktree of <main folder>. Merge into develop from the\n" +
      "main folder with git -C <main folder> merge --ff-only <commit>, where\n" +
      "<commit> is what git rev-parse HEAD prints in this worktree. If the\n" +
      "main folder is not on develop or the fast-forward fails, stop and say\n" +
      "the work is ready to merge.\n\n" +
      "Scratch: a short answer you can give from what you already know stays\n" +
      "with you. Anything that needs files, the web, code, or more than a short\n" +
      "spoken answer goes to the Scratch workspace with fresh: true, one fresh\n" +
      "session per unrelated job. Scratch jobs get no note lookup.\n\n" +
      "Note lookup: before every project task, to-do or not, ask the vault\n" +
      "workspace first. Find it in jarvis_list as the workspace with kind vault,\n" +
      "never by name. Send to its session labelled with the project name\n" +
      "(jarvis_launch with label: <project> if there is none yet). One lookup\n" +
      "covers a whole batch for one project. The prompt, with the task\n" +
      "line(s) copied in verbatim:\n\n" +
      'Note lookup for: <task line(s)>. Using your own CLAUDE.md search rules, find the daily notes and wiki pages related to this task. Answer in at most 10 lines, each a fact plus the note path it came from. Answer "nothing relevant" if nothing is.\n\n' +
      'End that turn with one sentence, such as "Asked the vault about the\n' +
      'Working-section task." When its finish wakes you, do not summarise it\n' +
      "aloud: send the project task, routed as above, with the pipeline\n" +
      "prompt followed by a line Notes context: and the vault's answer\n" +
      'verbatim. Skip that block when the answer is "nothing relevant", the\n' +
      "lookup failed, or there is no vault workspace.",
    inputSchema: {
      type: "object",
      properties: {
        workspace: {
          type: "string",
          description: "Target workspace name, as shown by jarvis_list",
        },
        prompt: { type: "string", description: "The prompt to submit" },
        session: {
          type: "string",
          description:
            'Label or topic of the live session to send to, as shown by jarvis_list. Needed when the workspace has more than one; ignored with fresh. Use "main" for a code project\'s main tab.',
        },
        fresh: {
          type: "boolean",
          description:
            "true to open a new session for the workspace (its own git worktree in a code repo) and send the prompt there. Answers with the new session's label. Refused at 4 sessions.",
        },
        label: {
          type: "string",
          description:
            "With fresh: one word naming the task, shown as the new tab's name from the start. The session label stays the order word. Ignored without fresh.",
        },
      },
      required: ["workspace", "prompt"],
    },
  },
  {
    name: "jarvis_launch",
    description:
      "Open a new Claude Code session for a workspace on the rail, in its own " +
      "git worktree for a code repo. Pass label to name it (for the vault " +
      "workspace, the project name); omit it for the next free number. " +
      "Returns once the session is ready for input, with its session label; " +
      "then jarvis_send to it with that session. If it says the session is " +
      "asking to trust its folder, do not jarvis_send yet: ask the user " +
      "whether they trust that folder, then call jarvis_trust with their " +
      "answer and the session. Fails if the name is unknown, the workspace " +
      "already has 4 sessions, or a session with that label is live. The " +
      "label `main` opens a code project's main-folder session, with no " +
      "worktree; if it is already live, send to it instead.",
    inputSchema: {
      type: "object",
      properties: {
        workspace: {
          type: "string",
          description: "Workspace name, as shown by jarvis_list",
        },
        label: {
          type: "string",
          description:
            "Session label, at most 20 characters of letters, digits, spaces and hyphens. Omit for the next free number.",
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
        session: {
          type: "string",
          description:
            "Label or topic of the session showing the prompt. Needed when the workspace has more than one.",
        },
      },
      required: ["workspace", "accept"],
    },
  },
  {
    name: "jarvis_close",
    description:
      "Close one session of a workspace, only when the user named it (at the " +
      "cap, ask which). Refused while that session is working, asking or " +
      "blocked, or printed output a moment ago. A worktree " +
      "with uncommitted or unmerged work stays on disk, and the answer names it.",
    inputSchema: {
      type: "object",
      properties: {
        workspace: {
          type: "string",
          description: "Workspace name, as shown by jarvis_list",
        },
        session: {
          type: "string",
          description: "Session label or topic, as shown by jarvis_list",
        },
      },
      required: ["workspace", "session"],
    },
  },
  {
    name: "jarvis_watch",
    description:
      "Block until a workspace other than this one finishes a turn, then " +
      "return { workspace, session, topic?, message } with that session's " +
      "full last assistant message; session is its label. When you speak a " +
      "finish, name the workspace and the tab: the topic when there is one, " +
      'else the session ("main" for the main tab). Returns { timeout: true } if ' +
      "nothing finishes in time. Call it again after you handle an event to " +
      "keep watching the fleet. When the finish is a vault note lookup, do " +
      "not summarise it aloud: pass its answer on as Notes context.",
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

// names the session a send or launch reached, and its worktree folder
const where = (out) =>
  (out?.session ? ` session "${out.session}"` : "") +
  (out?.worktree ? ` (git worktree ${out.worktree})` : "");

async function callTool(name, args) {
  try {
    if (name === "jarvis_list") {
      const fleet = await post("/orchestrate/list", {});
      return textResult(JSON.stringify(fleet, null, 2));
    }
    if (name === "jarvis_send") {
      const fresh = args?.fresh === true;
      // a fresh send opens a session and waits up to 20s for its TUI to
      // settle before sending, so give it the same bound as jarvis_launch
      const out = await post(
        "/orchestrate/send",
        {
          workspace: args?.workspace,
          prompt: args?.prompt,
          fresh,
          session: args?.session,
          label: args?.label,
        },
        fresh ? 30000 : undefined,
      );
      if (!out?.ok) return textResult(out?.error ?? "send failed", true);
      if (out.trustPrompt)
        return textResult(
          `opened session "${out.session}" in ${args?.workspace}, but it is ` +
            `asking whether to trust the folder ${out.trustPrompt}, so the ` +
            "prompt was not sent. Ask the user if they trust it, then call " +
            `jarvis_trust with their answer and session "${out.session}", ` +
            `then jarvis_send the prompt with session "${out.session}".`,
        );
      return textResult(`sent to ${args?.workspace}${where(out)}`);
    }
    if (name === "jarvis_launch") {
      // installs run before the spawn and the answer waits for the new TUI to
      // go quiet (up to 20s in main), so allow well past 1.5s
      const out = await post(
        "/orchestrate/launch",
        { workspace: args?.workspace, label: args?.label },
        30000,
      );
      if (!out?.ok) return textResult(out?.error ?? "launch failed", true);
      return textResult(
        out.trustPrompt
          ? `launched ${args?.workspace}${where(out)}, but its session is ` +
              `asking whether to trust the folder ${out.trustPrompt}. Ask the ` +
              "user if they trust it, then call jarvis_trust with their " +
              "answer. Do not jarvis_send to it before that."
          : `launched ${args?.workspace}${where(out)}`,
      );
    }
    if (name === "jarvis_close") {
      // the close waits for the process to exit and for git to check the
      // worktree, so allow well past 1.5s
      const out = await post(
        "/orchestrate/close",
        { workspace: args?.workspace, session: args?.session },
        30000,
      );
      if (!out?.ok) return textResult(out?.error ?? "close failed", true);
      return textResult(
        out.kept
          ? `closed ${args?.workspace} session "${args?.session}"; its ` +
              `worktree stays on disk: ${out.kept}`
          : `closed ${args?.workspace} session "${args?.session}"`,
      );
    }
    if (name === "jarvis_trust") {
      // the answer waits for the session to settle past the prompt
      const out = await post(
        "/orchestrate/trust",
        {
          workspace: args?.workspace,
          accept: args?.accept === true,
          session: args?.session,
        },
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
