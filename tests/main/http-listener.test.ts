import { describe, it, expect, vi } from "vitest";
import type { AddressInfo } from "node:net";
import { startListener } from "../../src/main/http-listener";
import type { StatusEvent, ToolEvent, Workspace } from "../../src/shared/types";
import { buildWorkspaces } from "../../src/main/workspaces";

const workspaces: Workspace[] = buildWorkspaces("D:\\vault", []);

async function start(
  onEvent: (e: ToolEvent) => void,
  onStatus: (s: StatusEvent) => void = () => {
    /* ignore */
  },
) {
  const server = startListener(0, onEvent, onStatus, () => workspaces);
  await new Promise((r) => server.once("listening", r));
  const { port } = server.address() as AddressInfo;
  return {
    port,
    server,
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
    body,
  });
}

describe("startListener", () => {
  it("maps a POSTed hook payload and forwards the tool event", async () => {
    const events: ToolEvent[] = [];
    const { server, url } = await start((e) => events.push(e));

    const res = await fetch(url, {
      method: "POST",
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
    const { server, url } = await start((e) => events.push(e));

    await fetch(url, { method: "POST", body: "not json{{{" });
    await fetch(url, {
      method: "POST",
      body: JSON.stringify({ tool_name: "Bash" }),
    });
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
});
