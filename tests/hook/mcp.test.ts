/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, afterEach } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AddressInfo } from "node:net";
import { AGENT_GUIDE } from "../../src/main/main-agent";

const MCP = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "src",
  "hook",
  "mcp.mjs",
);

const children: ChildProcess[] = [];
afterEach(() => {
  for (const c of children.splice(0)) c.kill();
});

function startMcp(port: number) {
  const child = spawn(process.execPath, [MCP], {
    env: { ...process.env, JARVIS_PORT: String(port) },
  });
  children.push(child);
  const lines: any[] = [];
  const waiters: Array<() => void> = [];
  let buf = "";
  child.stdout?.setEncoding("utf8");
  child.stdout?.on("data", (chunk: string) => {
    buf += chunk;
    let nl;
    while ((nl = buf.indexOf("\n")) !== -1) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      lines.push(JSON.parse(line));
      for (const w of waiters.splice(0)) w();
    }
  });
  const waitLine = (index: number): Promise<any> =>
    new Promise((resolve) => {
      const check = () => {
        if (lines.length > index) resolve(lines[index]);
        else waiters.push(check);
      };
      check();
    });
  // write one raw line, resolve with the next response line after it —
  // the index is captured BEFORE the write so a fast reply can't be missed
  const raw = (s: string): Promise<any> => {
    const i = lines.length;
    child.stdin?.write(s);
    return waitLine(i);
  };
  const request = (msg: unknown): Promise<any> =>
    raw(JSON.stringify(msg) + "\n");
  return { request, raw };
}

// a listener stand-in whose reply can depend on the request, for routes
// where different tools/urls need different (or slow) responses
async function startStubServer(
  reply: (url: string, body: string) => unknown | Promise<unknown>,
) {
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", async () => {
      const out = await reply(req.url ?? "", body);
      res.setHeader("content-type", "application/json");
      res.writeHead(200).end(JSON.stringify(out));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return { server, port: (server.address() as AddressInfo).port };
}

// a listener stand-in that records what mcp.mjs sends it
async function fakeListener(reply: unknown) {
  const hits: Array<{
    url: string;
    headers: http.IncomingHttpHeaders;
    body: string;
  }> = [];
  const server = http.createServer((req, res) => {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => {
      hits.push({ url: req.url ?? "", headers: req.headers, body: b });
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(reply));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const { port } = server.address() as AddressInfo;
  return { port, hits, close: () => server.close() };
}

describe("mcp.mjs", () => {
  it("answers initialize with tool capabilities and its identity", async () => {
    const { request } = startMcp(1);
    const res = await request({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {} },
    });
    expect(res.id).toBe(1);
    expect(res.result.protocolVersion).toBe("2025-06-18");
    expect(res.result.capabilities).toEqual({ tools: {} });
    expect(res.result.serverInfo.name).toBe("jarvis");
  });

  it("lists jarvis_list and jarvis_send first, with jarvis_send's schema", async () => {
    const { request } = startMcp(1);
    const res = await request({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    const names = res.result.tools.map((t: any) => t.name);
    expect(names.slice(0, 2)).toEqual(["jarvis_list", "jarvis_send"]);
    const send = res.result.tools[1];
    expect(send.inputSchema.required).toEqual(["workspace", "prompt"]);
  });

  it("tools/call jarvis_send POSTs to /orchestrate/send with the header", async () => {
    const listener = await fakeListener({ ok: true });
    const { request } = startMcp(listener.port);
    const res = await request({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "jarvis_send",
        arguments: { workspace: "AeroGraph", prompt: "fix it" },
      },
    });
    expect(listener.hits).toHaveLength(1);
    expect(listener.hits[0].url).toBe("/orchestrate/send");
    expect(listener.hits[0].headers["x-jarvis"]).toBe("1");
    expect(JSON.parse(listener.hits[0].body)).toEqual({
      workspace: "AeroGraph",
      prompt: "fix it",
      fresh: false,
    });
    expect(res.result.isError).toBeUndefined();
    listener.close();
  });

  it("jarvis_send's schema offers fresh as an optional boolean", async () => {
    const { request } = startMcp(1);
    const res = await request({ jsonrpc: "2.0", id: 20, method: "tools/list" });
    const send = res.result.tools[1];
    expect(send.inputSchema.properties.fresh.type).toBe("boolean");
    expect(send.inputSchema.properties.fresh.description).not.toContain(
      "/clear",
    );
    expect(send.inputSchema.properties.fresh.description).toContain(
      "new session",
    );
    expect(send.inputSchema.properties.session.type).toBe("string");
    expect(send.inputSchema.required).toEqual(["workspace", "prompt"]);
  });

  it("jarvis_send's schema offers an optional label for a fresh send", async () => {
    const { request } = startMcp(1);
    const res = await request({ jsonrpc: "2.0", id: 26, method: "tools/list" });
    const send = res.result.tools[1];
    expect(send.inputSchema.properties.label.type).toBe("string");
    expect(send.inputSchema.properties.label.description).toContain("fresh");
    expect(send.inputSchema.required).toEqual(["workspace", "prompt"]);
    expect(send.description).toContain(
      'Pass label with every fresh send: one word that names the task, such as\nlabel: "tabs". The new tab shows it at once.\n',
    );
  });

  it("tools/call jarvis_send forwards label", async () => {
    const listener = await fakeListener({ ok: true, session: "2" });
    const { request } = startMcp(listener.port);
    await request({
      jsonrpc: "2.0",
      id: 27,
      method: "tools/call",
      params: {
        name: "jarvis_send",
        arguments: { workspace: "A", prompt: "p", fresh: true, label: "tabs" },
      },
    });
    expect(JSON.parse(listener.hits[0].body).label).toBe("tabs");
    listener.close();
  });

  it("jarvis_launch takes an optional label and jarvis_trust a session", async () => {
    const { request } = startMcp(1);
    const res = await request({ jsonrpc: "2.0", id: 24, method: "tools/list" });
    const tool = (name: string) =>
      res.result.tools.find((t: any) => t.name === name);
    expect(tool("jarvis_launch").inputSchema.properties.label.type).toBe(
      "string",
    );
    expect(tool("jarvis_launch").inputSchema.required).toEqual(["workspace"]);
    expect(tool("jarvis_trust").inputSchema.properties.session.type).toBe(
      "string",
    );
    expect(tool("jarvis_close").inputSchema.required).toEqual([
      "workspace",
      "session",
    ]);
  });

  it("tools/call jarvis_send forwards session and names it in the answer", async () => {
    const listener = await fakeListener({
      ok: true,
      session: "2",
      worktree: "D:\\a\\.worktrees\\2",
    });
    const { request } = startMcp(listener.port);
    const res = await request({
      jsonrpc: "2.0",
      id: 25,
      method: "tools/call",
      params: {
        name: "jarvis_send",
        arguments: { workspace: "A", prompt: "p", fresh: true, session: "2" },
      },
    });
    expect(JSON.parse(listener.hits[0].body)).toEqual({
      workspace: "A",
      prompt: "p",
      fresh: true,
      session: "2",
    });
    const text = res.result.content[0].text;
    expect(text).toContain('session "2"');
    expect(text).toContain("D:\\a\\.worktrees\\2");
    listener.close();
  });

  it("a fresh send that hits a trust prompt tells the agent to ask the user", async () => {
    const listener = await fakeListener({
      ok: true,
      session: "1",
      trustPrompt: "D:\\a\\.worktrees\\1",
    });
    const { request } = startMcp(listener.port);
    const res = await request({
      jsonrpc: "2.0",
      id: 26,
      method: "tools/call",
      params: {
        name: "jarvis_send",
        arguments: { workspace: "A", prompt: "p", fresh: true },
      },
    });
    const text = res.result.content[0].text;
    expect(res.result.isError).toBeUndefined();
    expect(text).toContain("D:\\a\\.worktrees\\1");
    expect(text).toContain("Ask the user");
    expect(text).toContain("jarvis_trust");
    expect(text).toContain("not sent");
    listener.close();
  });

  it("tools/call jarvis_close POSTs to /orchestrate/close with the header", async () => {
    const listener = await fakeListener({
      ok: true,
      kept: "D:\\a\\.worktrees\\1 (uncommitted changes)",
    });
    const { request } = startMcp(listener.port);
    const res = await request({
      jsonrpc: "2.0",
      id: 27,
      method: "tools/call",
      params: {
        name: "jarvis_close",
        arguments: { workspace: "A", session: "1" },
      },
    });
    expect(listener.hits[0].url).toBe("/orchestrate/close");
    expect(listener.hits[0].headers["x-jarvis"]).toBe("1");
    expect(JSON.parse(listener.hits[0].body)).toEqual({
      workspace: "A",
      session: "1",
    });
    expect(res.result.isError).toBeUndefined();
    expect(res.result.content[0].text).toContain("uncommitted changes");
    listener.close();
  });

  it("a refused close comes back as a tool error", async () => {
    const listener = await fakeListener({
      ok: false,
      error: "A's session 1 is busy (working)",
    });
    const { request } = startMcp(listener.port);
    const res = await request({
      jsonrpc: "2.0",
      id: 28,
      method: "tools/call",
      params: {
        name: "jarvis_close",
        arguments: { workspace: "A", session: "1" },
      },
    });
    expect(res.result.isError).toBe(true);
    expect(res.result.content[0].text).toContain("busy");
    listener.close();
  });

  it("jarvis_send's description carries the pipeline and the fresh rule", async () => {
    const { request } = startMcp(1);
    const res = await request({ jsonrpc: "2.0", id: 21, method: "tools/list" });
    const description: string = res.result.tools[1].description;
    for (const needle of [
      "superpowers:brainstorming",
      "interactive-html-review",
      "superpowers:writing-plans",
      "superpowers:subagent-driven-development",
      "fresh: true",
      "@project",
      "To-do tasks:",
      "Never start a spec before the one before it is approved.",
      "for each spec in order",
      "Use the single-task prompt when only one task is chosen",
      "never share a prompt",
      "check by hand",
      "- [/]",
      "one sentence naming the workspace and the task",
      "never send a - [/] line",
    ]) {
      expect(description).toContain(needle);
    }
  });

  it("jarvis_send's pipelines tell every build subagent to run impact with repo", async () => {
    const { request } = startMcp(1);
    const res = await request({ jsonrpc: "2.0", id: 41, method: "tools/list" });
    const description: string = res.result.tools[1].description;
    const impactLine =
      "Before editing any existing function, class or method, run GitNexus\n" +
      "   impact on it and pass repo: the name list_repos gives for this\n" +
      "   project's main folder (call list_repos once). New files, tests and\n" +
      "   docs need no impact. Report each result in your summary.";
    expect(description.split(impactLine)).toHaveLength(3);
    expect(description).toContain("implementer or fix subagent");
    expect(description).not.toContain("repo: JARVIS");
  });

  it("jarvis_send tells the agent to confirm a send in a few words, like the guide", async () => {
    const { request } = startMcp(1);
    const res = await request({ jsonrpc: "2.0", id: 42, method: "tools/list" });
    const description: string = res.result.tools[1].description;
    expect(description).toContain("After a send, confirm it in a few words");
    expect(description).toContain("the finish turn reports the result");
    expect(AGENT_GUIDE).toContain(
      "Confirm a send in a few words: the finish turn reports the result.",
    );
  });

  it("jarvis_send's worktree merge line names the commit, not a branch", async () => {
    const { request } = startMcp(1);
    const res = await request({ jsonrpc: "2.0", id: 43, method: "tools/list" });
    const description: string = res.result.tools[1].description;
    expect(description).not.toContain("<branch>");
    expect(description).toContain("git rev-parse HEAD");
  });

  it("jarvis_send's description carries the session, Scratch, worktree and lookup rules", async () => {
    const { request } = startMcp(1);
    const res = await request({ jsonrpc: "2.0", id: 40, method: "tools/list" });
    const tool = (name: string) =>
      res.result.tools.find((t: any) => t.name === name);
    const send: string = tool("jarvis_send").description;
    for (const needle of [
      "Scratch",
      "fresh: true",
      "git -C",
      "--ff-only",
      "Note lookup for:",
      "Notes context:",
      "jarvis_close",
      "never by name",
      "trustPrompt",
      "nothing relevant",
    ]) {
      expect(send).toContain(needle);
    }
    expect(send).not.toContain("refused as busy");
    for (const needle of [
      'session: "main"',
      'jarvis_launch with label: "main"',
      "/clear",
      "overrides",
    ]) {
      expect(send).toContain(needle);
    }
    expect(send).not.toContain("Use fresh: true for any new spec or new task");
    const launch: string = tool("jarvis_launch").description;
    expect(launch).not.toContain("is refused for a code workspace");
    expect(launch).toContain("main-folder session");
    expect(launch).not.toContain("a session already exists");
    expect(launch).toContain("`main`");
    expect(launch).toContain("label");
    expect(launch).not.toContain("next free number");
    expect(launch).toContain("omit it to open the main tab");
    expect(launch).toContain("busy");
    const list: string = tool("jarvis_list").description;
    expect(list).toContain("session");
    expect(list).toContain("worktree");
    const watch: string = tool("jarvis_watch").description;
    expect(watch).toContain("do not summarise");
    expect(watch).toContain("session");
  });

  it("tools/call jarvis_send forwards fresh", async () => {
    const listener = await fakeListener({ ok: true });
    const { request } = startMcp(listener.port);
    await request({
      jsonrpc: "2.0",
      id: 22,
      method: "tools/call",
      params: {
        name: "jarvis_send",
        arguments: { workspace: "A", prompt: "p", fresh: true },
      },
    });
    expect(JSON.parse(listener.hits[0].body)).toEqual({
      workspace: "A",
      prompt: "p",
      fresh: true,
    });
    listener.close();
  });

  it("a fresh send waits past the 20 s settle deadline", async () => {
    const { server, port } = await startStubServer(async () => {
      await new Promise((r) => setTimeout(r, 3000));
      return { ok: true };
    });
    const { request } = startMcp(port);
    const res = await request({
      jsonrpc: "2.0",
      id: 23,
      method: "tools/call",
      params: {
        name: "jarvis_send",
        arguments: { workspace: "A", prompt: "p", fresh: true },
      },
    });
    expect(res.result.isError).toBeUndefined();
    expect(res.result.content[0].text).toBe("sent to A");
    server.close();
  }, 10000);

  it("a rejected send comes back as a tool error, not a protocol error", async () => {
    const listener = await fakeListener({ ok: false, error: "no workspace" });
    const { request } = startMcp(listener.port);
    const res = await request({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: {
        name: "jarvis_send",
        arguments: { workspace: "X", prompt: "p" },
      },
    });
    expect(res.result.isError).toBe(true);
    expect(res.result.content[0].text).toContain("no workspace");
    listener.close();
  });

  it("listener down → tool error, never a hang", async () => {
    const { request } = startMcp(1); // port 1 → refused immediately
    const res = await request({
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: { name: "jarvis_list", arguments: {} },
    });
    expect(res.result.isError).toBe(true);
  }, 5000);

  it("malformed and unknown input get standard JSON-RPC errors, server survives", async () => {
    const { request, raw } = startMcp(1);
    const parseErr = await raw("not json at all\n");
    expect(parseErr.error.code).toBe(-32700);
    const unknown = await request({ jsonrpc: "2.0", id: 6, method: "nope" });
    expect(unknown.error.code).toBe(-32601);
    const alive = await request({
      jsonrpc: "2.0",
      id: 7,
      method: "tools/list",
    });
    expect(alive.result.tools).toHaveLength(8);
  });

  it("tools/call jarvis_launch POSTs the name to /orchestrate/launch", async () => {
    const listener = await fakeListener({ ok: true });
    const { request } = startMcp(listener.port);
    const res = await request({
      jsonrpc: "2.0",
      id: 8,
      method: "tools/call",
      params: { name: "jarvis_launch", arguments: { workspace: "FinPulse" } },
    });
    expect(listener.hits[0].url).toBe("/orchestrate/launch");
    expect(listener.hits[0].headers["x-jarvis"]).toBe("1");
    expect(JSON.parse(listener.hits[0].body)).toEqual({
      workspace: "FinPulse",
    });
    expect(res.result.isError).toBeUndefined();
    listener.close();
  });

  it("tools/call jarvis_launch forwards a label and names the session", async () => {
    const listener = await fakeListener({ ok: true, session: "AeroGraph" });
    const { request } = startMcp(listener.port);
    const res = await request({
      jsonrpc: "2.0",
      id: 29,
      method: "tools/call",
      params: {
        name: "jarvis_launch",
        arguments: { workspace: "Obsidian-vault", label: "AeroGraph" },
      },
    });
    expect(JSON.parse(listener.hits[0].body)).toEqual({
      workspace: "Obsidian-vault",
      label: "AeroGraph",
    });
    expect(res.result.content[0].text).toContain('session "AeroGraph"');
    listener.close();
  });

  it("a refused launch comes back as a tool error", async () => {
    const listener = await fakeListener({
      ok: false,
      error: "FinPulse already has a live session",
    });
    const { request } = startMcp(listener.port);
    const res = await request({
      jsonrpc: "2.0",
      id: 9,
      method: "tools/call",
      params: { name: "jarvis_launch", arguments: { workspace: "FinPulse" } },
    });
    expect(res.result.isError).toBe(true);
    expect(res.result.content[0].text).toContain("already has a live session");
    listener.close();
  });

  it("tells the agent to ask the user when a launch hits a trust prompt", async () => {
    const listener = await fakeListener({ ok: true, trustPrompt: "D:\\new" });
    const { request } = startMcp(listener.port);
    const res = await request({
      jsonrpc: "2.0",
      id: 10,
      method: "tools/call",
      params: { name: "jarvis_launch", arguments: { workspace: "New" } },
    });
    const text = res.result.content[0].text;
    expect(text).toContain("D:\\new");
    expect(text).toContain("Ask the user");
    expect(text).toContain("jarvis_trust");
    listener.close();
  });

  it("tools/call jarvis_trust POSTs the user's answer to /orchestrate/trust", async () => {
    const listener = await fakeListener({ ok: true });
    const { request } = startMcp(listener.port);
    const res = await request({
      jsonrpc: "2.0",
      id: 11,
      method: "tools/call",
      params: {
        name: "jarvis_trust",
        arguments: { workspace: "New", accept: true, session: "1" },
      },
    });
    expect(listener.hits[0].url).toBe("/orchestrate/trust");
    expect(JSON.parse(listener.hits[0].body)).toEqual({
      workspace: "New",
      accept: true,
      session: "1",
    });
    expect(res.result.content[0].text).toContain("ready for jarvis_send");
    listener.close();
  });

  it("lists the two v0.4.1 tools", async () => {
    const { server, port } = await startStubServer(() => ({}));
    const { request } = startMcp(port);
    await request({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
    const res = await request({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    const names = res.result.tools.map((t: any) => t.name);
    expect(names).toContain("jarvis_watch");
    expect(names).toContain("jarvis_say");
    server.close();
  });

  it("waits out a slow watch instead of aborting at 1500ms", async () => {
    const { server, port } = await startStubServer(async (url) => {
      if (url === "/orchestrate/watch") {
        await new Promise((r) => setTimeout(r, 2500)); // past the default bound
        return { workspace: "AeroGraph", message: "done" };
      }
      return {};
    });
    const { request } = startMcp(port);
    await request({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
    const res = await request({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "jarvis_watch", arguments: { timeout_seconds: 5 } },
    });
    expect(res.result.content[0].text).toContain("AeroGraph");
    expect(res.result.isError).toBeFalsy();
    server.close();
  }, 15000);

  it("reports a say failure as a tool error", async () => {
    const { server, port } = await startStubServer(() => ({
      ok: false,
      error: "no JARVIS window is listening",
    }));
    const { request } = startMcp(port);
    await request({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
    const res = await request({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "jarvis_say", arguments: { text: "hi" } },
    });
    expect(res.result.isError).toBe(true);
    expect(res.result.content[0].text).toContain("listening");
    server.close();
  });

  it("tools/call jarvis_todos POSTs to /orchestrate/todos and returns the file", async () => {
    const listener = await fakeListener({
      path: "C:\\data\\main-agent\\TODO.md",
      text: "- [ ] a\n",
      malformed: [],
    });
    const { request } = startMcp(listener.port);
    const list = await request({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    const tool = list.result.tools.find((t: any) => t.name === "jarvis_todos");
    expect(tool.description).toContain("YYYY-MM-DD");
    expect(tool.description).toContain("malformed");
    expect(tool.description).toContain("merged into develop also counts");
    expect(tool.description).toContain("each task it clearly covers");
    expect(tool.description).toContain("- [/]");
    const res = await request({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "jarvis_todos", arguments: {} },
    });
    expect(listener.hits[0].url).toBe("/orchestrate/todos");
    expect(listener.hits[0].headers["x-jarvis"]).toBe("1");
    expect(JSON.parse(res.result.content[0].text).path).toBe(
      "C:\\data\\main-agent\\TODO.md",
    );
    expect(res.result.isError).toBeUndefined();
    listener.close();
  });

  it("reports a todos failure as a tool error", async () => {
    const listener = await fakeListener({ error: "EBUSY: TODO.md is locked" });
    const { request } = startMcp(listener.port);
    const res = await request({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "jarvis_todos", arguments: {} },
    });
    expect(res.result.isError).toBe(true);
    expect(res.result.content[0].text).toContain("locked");
    listener.close();
  });
});
