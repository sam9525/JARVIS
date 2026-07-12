import { describe, it, expect, vi } from "vitest";
import type { AddressInfo } from "node:net";
import { startListener } from "../src/main/http-listener";
import type { ToolEvent } from "../src/shared/types";

async function listen(onEvent: (e: ToolEvent) => void) {
  const server = startListener(0, onEvent);
  await new Promise((r) => server.once("listening", r));
  const { port } = server.address() as AddressInfo;
  return { server, url: `http://127.0.0.1:${port}/event` };
}

describe("startListener", () => {
  it("maps a POSTed hook payload and forwards the tool event", async () => {
    const events: ToolEvent[] = [];
    const { server, url } = await listen((e) => events.push(e));

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
    const { server, url } = await listen((e) => events.push(e));

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
});
