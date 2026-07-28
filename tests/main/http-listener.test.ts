import { describe, it, expect, vi } from "vitest";
import type { AddressInfo } from "node:net";
import { startListener } from "../../src/main/http-listener";
import type { StatusEvent, ToolEvent, Workspace } from "../../src/shared/types";
import { buildWorkspaces } from "../../src/main/workspaces";

const workspaces: Workspace[] = buildWorkspaces("D:\\vault", []);

function stubOrchestrator() {
  const sends: Array<[string, string]> = [];
  return {
    sends,
    listCalls: { n: 0 },
    list() {
      this.listCalls.n++;
      return [{ name: "vault", live: false }];
    },
    send(workspace: string, prompt: string) {
      sends.push([workspace, prompt]);
      return { ok: true as const };
    },
  };
}

async function start(
  onEvent: (e: ToolEvent) => void,
  onStatus: (s: StatusEvent) => void = () => {
    /* ignore */
  },
) {
  const orch = stubOrchestrator();
  const server = startListener(0, onEvent, onStatus, () => workspaces, orch);
  await new Promise((r) => server.once("listening", r));
  const { port } = server.address() as AddressInfo;
  return {
    port,
    server,
    orch,
    url: `http://127.0.0.1:${port}/event`,
    close: () => server.close(),
  };
}

async function post(port: number, body: unknown) {
  return fetch(`http://127.0.0.1:${port}/event`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function postRaw(port: number, body: string) {
  return fetch(`http://127.0.0.1:${port}/event`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
}

describe("startListener", () => {
  it("maps a POSTed hook payload and forwards the tool event", async () => {
    const events: ToolEvent[] = [];
    const { server, url } = await start((e) => events.push(e));

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        session_id: "s1",
        cwd: "D:\\vault",
        hook_event_name: "PreToolUse",
        tool_name: "Read",
        tool_input: { file_path: "D:\\vault\\notes\\beta.md" },
      }),
    });
    expect(res.status).toBe(200);

    await vi.waitFor(() => expect(events).toHaveLength(1));
    expect(events[0]).toMatchObject({ tool: "Read", nodeIds: ["notes/beta"] });
    server.close();
  });

  it("swallows malformed bodies and unmapped events without crashing", async () => {
    const events: ToolEvent[] = [];
    const { server, port, url } = await start((e) => events.push(e));

    await postRaw(port, "not json{{{");
    await post(port, { tool_name: "Bash" });
    const notFound = await fetch(url.replace("/event", "/nope"), {
      method: "POST",
      body: "{}",
    });

    expect(notFound.status).toBe(404);
    expect(events).toHaveLength(0);
    server.close();
  });

  it("feeds both mappers from one payload, independently", async () => {
    const tools: unknown[] = [];
    const statuses: unknown[] = [];
    const { port, close } = await start(
      (e) => tools.push(e),
      (s) => statuses.push(s),
    );
    // a Read fires BOTH: a highlight event and a running status
    await post(port, {
      session_id: "s1",
      cwd: "D:\\vault",
      hook_event_name: "PreToolUse",
      tool_name: "Read",
      tool_input: { file_path: "D:\\vault\\a.md" },
    });
    expect(tools).toHaveLength(1);
    expect(statuses).toHaveLength(1);

    // a Stop is status-only — the highlight mapper must not see it
    await post(port, {
      session_id: "s1",
      cwd: "D:\\vault",
      hook_event_name: "Stop",
    });
    expect(tools).toHaveLength(1);
    expect(statuses).toHaveLength(2);
    close();
  });

  it("a malformed body reaches neither mapper and does not crash", async () => {
    const tools: unknown[] = [];
    const statuses: unknown[] = [];
    const { port, close } = await start(
      (e) => tools.push(e),
      (s) => statuses.push(s),
    );
    await postRaw(port, "{not json");
    expect(tools).toHaveLength(0);
    expect(statuses).toHaveLength(0);
    close();
  });

  // text/plain is the CORS simple-request shape a web page can fire without a
  // preflight; requiring JSON forces one, and we never answer preflights
  it("rejects a non-JSON content-type before either mapper runs", async () => {
    const tools: unknown[] = [];
    const statuses: unknown[] = [];
    const { port, close } = await start(
      (e) => tools.push(e),
      (s) => statuses.push(s),
    );
    const res = await fetch(`http://127.0.0.1:${port}/event`, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify({
        session_id: "s1",
        cwd: "D:\\vault",
        hook_event_name: "Stop",
        last_assistant_message: "<b>spoofed</b>",
      }),
    });
    expect(res.status).toBe(415);
    expect(tools).toHaveLength(0);
    expect(statuses).toHaveLength(0);
    close();
  });

  it("drops a body over the size cap instead of buffering it", async () => {
    const statuses: unknown[] = [];
    const { port, close } = await start(
      () => {
        /* no-op */
      },
      (s) => statuses.push(s),
    );
    const huge = JSON.stringify({
      session_id: "s1",
      cwd: "D:\\vault",
      hook_event_name: "Stop",
      last_assistant_message: "x".repeat(2 << 20),
    });
    await postRaw(port, huge).catch(() => null); // socket destroyed mid-send
    expect(statuses).toHaveLength(0);
    close();
  });
});

describe("orchestrate routes", () => {
  const post = (
    port: number,
    path: string,
    body: string,
    headers: Record<string, string> = {},
  ) =>
    fetch(`http://127.0.0.1:${port}${path}`, {
      method: "POST",
      headers,
      body,
    });

  it("rejects requests without the x-jarvis header before any handler runs", async () => {
    const { port, orch, close } = await start(() => {
      /* no-op */
    });
    const list = await post(port, "/orchestrate/list", "{}");
    const send = await post(
      port,
      "/orchestrate/send",
      JSON.stringify({ workspace: "a", prompt: "p" }),
      // text/plain is the CORS simple-request shape a web page could fire
      { "content-type": "text/plain" },
    );
    expect(list.status).toBe(403);
    expect(send.status).toBe(403);
    expect(orch.listCalls.n).toBe(0);
    expect(orch.sends).toEqual([]);
    close();
  });

  it("list answers JSON when the header is present", async () => {
    const { port, orch, close } = await start(() => {
      /* no-op */
    });
    const res = await post(port, "/orchestrate/list", "{}", {
      "x-jarvis": "1",
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([{ name: "vault", live: false }]);
    expect(orch.listCalls.n).toBe(1);
    close();
  });

  it("send maps the body onto orchestrator.send", async () => {
    const { port, orch, close } = await start(() => {
      /* no-op */
    });
    const res = await post(
      port,
      "/orchestrate/send",
      JSON.stringify({ workspace: "AeroGraph", prompt: "fix it" }),
      { "x-jarvis": "1" },
    );
    expect(await res.json()).toEqual({ ok: true });
    expect(orch.sends).toEqual([["AeroGraph", "fix it"]]);
    close();
  });

  it("a malformed send body reaches no handler and reports the failure", async () => {
    const { port, orch, close } = await start(() => {
      /* no-op */
    });
    const res = await post(port, "/orchestrate/send", "{not json", {
      "x-jarvis": "1",
    });
    const out = (await res.json()) as { ok: boolean };
    expect(out.ok).toBe(false);
    expect(orch.sends).toEqual([]);
    close();
  });

  // an uncaught throw in an http handler takes down Electron main, not the request
  it("answers 500 when list throws, instead of crashing", async () => {
    const server = startListener(
      0,
      () => {
        /* no-op */
      },
      () => {
        /* no-op */
      },
      () => workspaces,
      {
        list() {
          throw new Error("snapshot exploded");
        },
        send: () => ({ ok: true as const }),
      },
    );
    await new Promise((r) => server.once("listening", r));
    const { port } = server.address() as AddressInfo;
    const res = await post(port, "/orchestrate/list", "{}", {
      "x-jarvis": "1",
    });
    expect(res.status).toBe(500);
    server.close();
  });

  it("GET (a preflight-ish probe) is 404, never answered as CORS", async () => {
    const { port, close } = await start(() => {
      /* no-op */
    });
    const res = await fetch(`http://127.0.0.1:${port}/orchestrate/list`);
    expect(res.status).toBe(404);
    close();
  });
});
