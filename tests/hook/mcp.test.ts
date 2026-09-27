/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, afterEach } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AddressInfo } from "node:net";

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
    });
    expect(res.result.isError).toBeUndefined();
    listener.close();
  });

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
    expect(alive.result.tools).toHaveLength(5);
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
});
