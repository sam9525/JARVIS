import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import * as textQuestion from "../../src/main/text-question-mapper";
import * as agents from "../../src/main/agents";
import type { AgentAdapter } from "../../src/main/agents";
import type { AddressInfo } from "node:net";
import { startListener } from "../../src/main/http-listener";
import type { StatusEvent, ToolEvent, Workspace } from "../../src/shared/types";
import { buildWorkspaces } from "../../src/main/workspaces";
import type { DeliveredResult } from "../../src/main/orchestrate";

const workspaces: Workspace[] = buildWorkspaces("D:\\vault", []);

function stubOrchestrator() {
  const sends: Array<
    [string, string, { session?: string; fresh?: boolean } | undefined]
  > = [];
  return {
    sends,
    sendResult: { ok: true } as DeliveredResult,
    listCalls: { n: 0 },
    list() {
      this.listCalls.n++;
      return [{ name: "vault", live: false }];
    },
    send(
      workspace: string,
      prompt: string,
      opts?: { session?: string; fresh?: boolean },
    ) {
      sends.push([workspace, prompt, opts]);
      return Promise.resolve(this.sendResult);
    },
    says: [] as string[],
    watchCalls: [] as number[],
    watch(timeoutSeconds?: number) {
      this.watchCalls.push(Number(timeoutSeconds));
      return Promise.resolve({ workspace: "AeroGraph", message: "done" });
    },
    say(text: string) {
      this.says.push(text);
      return { ok: true as const };
    },
    launches: [] as Array<[string, string | undefined]>,
    resumes: [] as boolean[],
    agents: [] as Array<string | undefined>,
    launch(workspace: string, label?: string, resume = false, agent?: string) {
      this.launches.push([workspace, label]);
      this.resumes.push(resume);
      this.agents.push(agent);
      return Promise.resolve({ ok: true as const, session: "1" });
    },
    trusts: [] as Array<[string, boolean, string | undefined]>,
    trust(workspace: string, accept: boolean, session?: string) {
      this.trusts.push([workspace, accept, session]);
      return Promise.resolve({ ok: true as const });
    },
    closes: [] as Array<[string, string]>,
    close(workspace: string, session: string) {
      this.closes.push([workspace, session]);
      return Promise.resolve({
        ok: true as const,
        kept: "D:\\a\\.worktrees\\1",
      });
    },
    todosCalls: { n: 0 },
    todos() {
      this.todosCalls.n++;
      return Promise.resolve({
        path: "C:\\data\\main-agent\\TODO.md",
        text: "- [ ] a\n",
        malformed: [],
      });
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
    expect(orch.sends).toEqual([
      ["AeroGraph", "fix it", { session: undefined, fresh: false }],
    ]);
    close();
  });

  it("send forwards the session and a literal fresh: true", async () => {
    const { port, orch, close } = await start(() => {
      /* no-op */
    });
    orch.sendResult = { ok: true, session: "2", worktree: "D:\\a\\.wt\\2" };
    const res = await post(
      port,
      "/orchestrate/send",
      JSON.stringify({
        workspace: "A",
        prompt: "p",
        fresh: true,
        session: "2",
      }),
      { "x-jarvis": "1" },
    );
    expect(await res.json()).toEqual({
      ok: true,
      session: "2",
      worktree: "D:\\a\\.wt\\2",
    });
    expect(orch.sends).toEqual([["A", "p", { session: "2", fresh: true }]]);
    close();
  });

  it("send passes agent codex through and drops any other value", async () => {
    const { port, orch, close } = await start(() => {
      /* no-op */
    });
    for (const agent of ["codex", "claude", "Codex", 1]) {
      await post(
        port,
        "/orchestrate/send",
        JSON.stringify({ workspace: "A", prompt: "p", fresh: true, agent }),
        { "x-jarvis": "1" },
      );
    }
    const agents = orch.sends.map(([, , opts]) => opts);
    expect(agents[0]).toHaveProperty("agent", "codex");
    for (const opts of agents.slice(1))
      expect(opts).not.toHaveProperty("agent");
    close();
  });

  it("send forwards the label of a fresh send", async () => {
    const { port, orch, close } = await start(() => {
      /* no-op */
    });
    await post(
      port,
      "/orchestrate/send",
      JSON.stringify({
        workspace: "AeroGraph",
        prompt: "p",
        fresh: true,
        label: "tabs",
      }),
      { "x-jarvis": "1" },
    );
    expect(orch.sends).toEqual([
      ["AeroGraph", "p", { session: undefined, fresh: true, label: "tabs" }],
    ]);
    close();
  });

  it.each(["true", 1, null])(
    "a fresh that is not literally true is a plain send (%s)",
    async (fresh) => {
      const { port, orch, close } = await start(() => {
        /* no-op */
      });
      await post(
        port,
        "/orchestrate/send",
        JSON.stringify({ workspace: "A", prompt: "p", fresh }),
        { "x-jarvis": "1" },
      );
      expect(orch.sends).toEqual([
        ["A", "p", { session: undefined, fresh: false }],
      ]);
      close();
    },
  );

  it("a session that is not a string is left out", async () => {
    const { port, orch, close } = await start(() => {
      /* no-op */
    });
    await post(
      port,
      "/orchestrate/send",
      JSON.stringify({ workspace: "A", prompt: "p", session: 2 }),
      { "x-jarvis": "1" },
    );
    expect(orch.sends).toEqual([
      ["A", "p", { session: undefined, fresh: false }],
    ]);
    close();
  });

  it("a rejected send comes back as its error", async () => {
    const { port, orch, close } = await start(() => {
      /* no-op */
    });
    orch.sendResult = { ok: false, error: "A has 4 sessions" };
    const res = await post(
      port,
      "/orchestrate/send",
      JSON.stringify({ workspace: "A", prompt: "p", fresh: true }),
      { "x-jarvis": "1" },
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: false,
      error: "A has 4 sessions",
    });
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
        send: () => Promise.resolve({ ok: true as const }),
        watch: () => Promise.resolve(null),
        say: () => ({ ok: true as const }),
        todos: () => Promise.resolve(null),
        launch: () => Promise.resolve({ ok: true as const, session: "1" }),
        trust: () => Promise.resolve({ ok: true as const }),
        close: () => Promise.resolve({ ok: true as const }),
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

describe("orchestrate routes added in v0.4.1", () => {
  const call = (
    port: number,
    path: string,
    body: unknown,
    headers: Record<string, string> = { "x-jarvis": "1" },
  ) =>
    fetch(`http://127.0.0.1:${port}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    });

  it("watch returns the finish and forwards the timeout", async () => {
    const s = await start(() => {
      /* no-op */
    });
    const res = await call(s.port, "/orchestrate/watch", {
      timeout_seconds: 30,
    });
    expect(await res.json()).toEqual({
      workspace: "AeroGraph",
      message: "done",
    });
    expect(s.orch.watchCalls).toEqual([30]);
    s.close();
  });

  // a parked watch outlives its request if the MCP client dies mid-poll; the
  // route hands the orchestrator a signal so the waiter is released instead of
  // resolving into a dead socket and swallowing the finish
  it("aborts the parked watch when the client hangs up", async () => {
    const s = await start(() => {
      /* no-op */
    });
    let signal: AbortSignal | undefined;
    s.orch.watch = (_secs?: number, sig?: AbortSignal) => {
      signal = sig;
      return new Promise<never>(() => {
        /* parks: the finish never arrives */
      });
    };
    const ctl = new AbortController();
    const hangup = fetch(`http://127.0.0.1:${s.port}/orchestrate/watch`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-jarvis": "1" },
      body: "{}",
      signal: ctl.signal,
    }).catch(() => undefined);
    await vi.waitFor(() => expect(signal).toBeDefined());
    ctl.abort();
    await hangup;
    await vi.waitFor(() => expect(signal?.aborted).toBe(true));
    s.close();
  });

  it("say forwards the text", async () => {
    const s = await start(() => {
      /* no-op */
    });
    const res = await call(s.port, "/orchestrate/say", { text: "all green" });
    expect(await res.json()).toEqual({ ok: true });
    expect(s.orch.says).toEqual(["all green"]);
    s.close();
  });

  it("both refuse a request without the x-jarvis header", async () => {
    const s = await start(() => {
      /* no-op */
    });
    for (const path of ["/orchestrate/watch", "/orchestrate/say"]) {
      const res = await call(s.port, path, {}, {});
      expect(res.status).toBe(403);
    }
    expect(s.orch.says).toEqual([]);
    expect(s.orch.watchCalls).toEqual([]);
    s.close();
  });

  it("todos answers the orchestrator's path, text and malformed lines", async () => {
    const s = await start(() => {
      /* no-op */
    });
    const res = await call(s.port, "/orchestrate/todos", {});
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      path: "C:\\data\\main-agent\\TODO.md",
      text: "- [ ] a\n",
      malformed: [],
    });
    expect(s.orch.todosCalls.n).toBe(1);
    s.close();
  });

  it("todos refuses a request without the x-jarvis header", async () => {
    const s = await start(() => {
      /* no-op */
    });
    const res = await call(s.port, "/orchestrate/todos", {}, {});
    expect(res.status).toBe(403);
    expect(s.orch.todosCalls.n).toBe(0);
    s.close();
  });

  it("todos answers 500 when the orchestrator rejects", async () => {
    const s = await start(() => {
      /* no-op */
    });
    s.orch.todos = () => Promise.reject(new Error("EBUSY"));
    const res = await call(s.port, "/orchestrate/todos", {});
    expect(res.status).toBe(500);
    s.close();
  });

  // watch's timeout_seconds arrives from the wire, unlike orchestrator.watch's
  // own callers — this is where hostile/malformed input first gets parsed, so
  // these assert what the route forwards, not the orchestrator's own clamping
  // (already covered by orchestrate.test.ts). vi.spyOn reads the raw argument,
  // bypassing stubOrchestrator's own Number(timeoutSeconds) normalization.
  describe("timeout_seconds parsing", () => {
    it("forwards a value far above the cap uncapped — clamping is the orchestrator's job", async () => {
      const s = await start(() => {
        /* no-op */
      });
      const spy = vi.spyOn(s.orch, "watch");
      await call(s.port, "/orchestrate/watch", { timeout_seconds: 1000 });
      expect(spy.mock.calls[0][0]).toBe(1000);
      s.close();
    });

    it("forwards zero as-is", async () => {
      const s = await start(() => {
        /* no-op */
      });
      const spy = vi.spyOn(s.orch, "watch");
      await call(s.port, "/orchestrate/watch", { timeout_seconds: 0 });
      expect(spy.mock.calls[0][0]).toBe(0);
      s.close();
    });

    it("forwards a negative value as-is", async () => {
      const s = await start(() => {
        /* no-op */
      });
      const spy = vi.spyOn(s.orch, "watch");
      await call(s.port, "/orchestrate/watch", { timeout_seconds: -5 });
      expect(spy.mock.calls[0][0]).toBe(-5);
      s.close();
    });

    it("forwards undefined, never NaN, for a non-numeric string", async () => {
      const s = await start(() => {
        /* no-op */
      });
      const spy = vi.spyOn(s.orch, "watch");
      await call(s.port, "/orchestrate/watch", { timeout_seconds: "soon" });
      expect(spy.mock.calls[0][0]).toBeUndefined();
      s.close();
    });

    it("forwards undefined, never NaN, for an object value", async () => {
      const s = await start(() => {
        /* no-op */
      });
      const spy = vi.spyOn(s.orch, "watch");
      await call(s.port, "/orchestrate/watch", {
        timeout_seconds: { not: "a number" },
      });
      expect(spy.mock.calls[0][0]).toBeUndefined();
      s.close();
    });

    it("forwards undefined, never NaN, for an explicit null", async () => {
      const s = await start(() => {
        /* no-op */
      });
      const spy = vi.spyOn(s.orch, "watch");
      await call(s.port, "/orchestrate/watch", { timeout_seconds: null });
      expect(spy.mock.calls[0][0]).toBeUndefined();
      s.close();
    });

    it("forwards undefined when the field is absent entirely", async () => {
      const s = await start(() => {
        /* no-op */
      });
      const spy = vi.spyOn(s.orch, "watch");
      await call(s.port, "/orchestrate/watch", {});
      expect(spy.mock.calls[0][0]).toBeUndefined();
      s.close();
    });
  });
});

describe("the ask channel", () => {
  it("pushes a prompt on PreToolUse and an empty one on PostToolUse", async () => {
    const seen: Array<unknown> = [];
    const server = startListener(
      0,
      () => {
        /* no-op */
      },
      () => {
        /* no-op */
      },
      () => workspaces,
      stubOrchestrator(),
      (p) => seen.push(p),
    );
    await new Promise((r) => server.once("listening", r));
    const port = (server.address() as { port: number }).port;
    await post(port, {
      session_id: "s1",
      cwd: "D:\\vault",
      hook_event_name: "PreToolUse",
      tool_name: "AskUserQuestion",
      tool_input: {
        questions: [{ question: "Which?", header: "H", options: [] }],
      },
    });
    await post(port, {
      session_id: "s1",
      cwd: "D:\\vault",
      hook_event_name: "PostToolUse",
      tool_name: "AskUserQuestion",
      tool_response: {},
    });
    server.close();
    expect(seen).toHaveLength(2);
    expect((seen[0] as { questions: unknown[] }).questions).toHaveLength(1);
    // the clear names its own workspace, so answering one question in a fleet
    // cannot close another workspace's open panel
    const clear = seen[1] as { questions: unknown[]; workspaceId: string };
    expect(clear.questions).toHaveLength(0);
    expect(clear.workspaceId).toBe(workspaces[0].id);
  });

  it("never calls onAsk for an unrelated event", async () => {
    const seen: Array<unknown> = [];
    const server = startListener(
      0,
      () => {
        /* no-op */
      },
      () => {
        /* no-op */
      },
      () => workspaces,
      stubOrchestrator(),
      (p) => seen.push(p),
    );
    await new Promise((r) => server.once("listening", r));
    const port = (server.address() as { port: number }).port;
    await post(port, {
      session_id: "s1",
      cwd: "D:\\vault",
      hook_event_name: "PreCompact",
    });
    server.close();
    expect(seen).toHaveLength(0);
  });
});

describe("/orchestrate/launch", () => {
  const call = (port: number, body: string, headers: Record<string, string>) =>
    fetch(`http://127.0.0.1:${port}/orchestrate/launch`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body,
    });

  it("forwards the workspace name and answers the result", async () => {
    const s = await start(() => {
      /* no-op */
    });
    const res = await call(s.port, JSON.stringify({ workspace: "AeroGraph" }), {
      "x-jarvis": "1",
    });
    expect(await res.json()).toEqual({ ok: true, session: "1" });
    expect(s.orch.launches).toEqual([["AeroGraph", undefined]]);
    s.close();
  });

  it("forwards a label", async () => {
    const s = await start(() => {
      /* no-op */
    });
    await call(
      s.port,
      JSON.stringify({ workspace: "Obsidian-vault", label: "AeroGraph" }),
      { "x-jarvis": "1" },
    );
    expect(s.orch.launches).toEqual([["Obsidian-vault", "AeroGraph"]]);
    s.close();
  });

  it("forwards resume only when it is true", async () => {
    const s = await start(() => {
      /* no-op */
    });
    const body = (resume: unknown) =>
      JSON.stringify({ workspace: "AeroGraph", label: "main", resume });
    await call(s.port, body(true), { "x-jarvis": "1" });
    await call(s.port, body("yes"), { "x-jarvis": "1" });
    expect(s.orch.resumes).toEqual([true, false]);
    s.close();
  });

  it("passes agent codex through and drops any other value", async () => {
    const s = await start(() => {
      /* no-op */
    });
    for (const agent of ["codex", "claude", "CODEX", null]) {
      await call(s.port, JSON.stringify({ workspace: "AeroGraph", agent }), {
        "x-jarvis": "1",
      });
    }
    expect(s.orch.agents).toEqual(["codex", undefined, undefined, undefined]);
    s.close();
  });

  it("needs the x-jarvis header like every orchestrate route", async () => {
    const s = await start(() => {
      /* no-op */
    });
    await call(s.port, JSON.stringify({ workspace: "AeroGraph" }), {});
    expect(s.orch.launches).toEqual([]);
    s.close();
  });

  it("a malformed body is an error result, not a launch", async () => {
    const s = await start(() => {
      /* no-op */
    });
    const res = await call(s.port, "{not json", { "x-jarvis": "1" });
    expect((await res.json()).ok).toBe(false);
    expect(s.orch.launches).toEqual([]);
    s.close();
  });
});

describe("/orchestrate/trust", () => {
  const call = (port: number, body: unknown, headers: Record<string, string>) =>
    fetch(`http://127.0.0.1:${port}/orchestrate/trust`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    });

  it("forwards the workspace and the answer", async () => {
    const s = await start(() => {
      /* no-op */
    });
    const res = await call(
      s.port,
      { workspace: "New", accept: true },
      { "x-jarvis": "1" },
    );
    expect(await res.json()).toEqual({ ok: true });
    expect(s.orch.trusts).toEqual([["New", true, undefined]]);
    s.close();
  });

  it("forwards the session", async () => {
    const s = await start(() => {
      /* no-op */
    });
    await call(
      s.port,
      { workspace: "New", accept: true, session: "1" },
      { "x-jarvis": "1" },
    );
    expect(s.orch.trusts).toEqual([["New", true, "1"]]);
    s.close();
  });

  it("reads anything but a literal true as a decline", async () => {
    const s = await start(() => {
      /* no-op */
    });
    await call(
      s.port,
      { workspace: "New", accept: "yes" },
      { "x-jarvis": "1" },
    );
    expect(s.orch.trusts).toEqual([["New", false, undefined]]);
    s.close();
  });

  it("needs the x-jarvis header", async () => {
    const s = await start(() => {
      /* no-op */
    });
    await call(s.port, { workspace: "New", accept: true }, {});
    expect(s.orch.trusts).toEqual([]);
    s.close();
  });
});

describe("/orchestrate/close", () => {
  const call = (port: number, body: string, headers: Record<string, string>) =>
    fetch(`http://127.0.0.1:${port}/orchestrate/close`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body,
    });

  it("forwards the workspace and session and answers the result", async () => {
    const s = await start(() => {
      /* no-op */
    });
    const res = await call(
      s.port,
      JSON.stringify({ workspace: "AeroGraph", session: "1" }),
      { "x-jarvis": "1" },
    );
    expect(await res.json()).toEqual({
      ok: true,
      kept: "D:\\a\\.worktrees\\1",
    });
    expect(s.orch.closes).toEqual([["AeroGraph", "1"]]);
    s.close();
  });

  it("needs the x-jarvis header", async () => {
    const s = await start(() => {
      /* no-op */
    });
    const res = await call(
      s.port,
      JSON.stringify({ workspace: "AeroGraph", session: "1" }),
      {},
    );
    expect(res.status).toBe(403);
    expect(s.orch.closes).toEqual([]);
    s.close();
  });

  it("a malformed body is an error result, not a close", async () => {
    const s = await start(() => {
      /* no-op */
    });
    const res = await call(s.port, "{not json", { "x-jarvis": "1" });
    expect((await res.json()).ok).toBe(false);
    expect(s.orch.closes).toEqual([]);
    s.close();
  });
});

describe("statusline route", () => {
  async function startWithStatusLine(
    onStatusLine: (key: string, raw: Record<string, unknown>) => void,
  ) {
    const server = startListener(
      0,
      () => undefined,
      () => undefined,
      () => workspaces,
      stubOrchestrator(),
      undefined,
      onStatusLine,
    );
    await new Promise((r) => server.once("listening", r));
    const { port } = server.address() as AddressInfo;
    return { port, close: () => server.close() };
  }
  const postStatus = (port: number, body: unknown, type = "application/json") =>
    fetch(`http://127.0.0.1:${port}/statusline`, {
      method: "POST",
      headers: { "Content-Type": type },
      body: JSON.stringify(body),
    });

  it("statusline route passes the session key and body", async () => {
    const calls: Array<[string, Record<string, unknown>]> = [];
    const { port, close } = await startWithStatusLine((k, r) =>
      calls.push([k, r]),
    );
    const res = await postStatus(port, {
      model: { display_name: "Opus" },
      jarvis_session: "s1",
    });
    expect(res.status).toBe(200);
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0][0]).toBe("s1");
    expect(calls[0][1].model).toEqual({ display_name: "Opus" });
    await postStatus(port, { model: {} }); // no key: ignored
    await new Promise((r) => setTimeout(r, 50));
    expect(calls).toHaveLength(1);
    close();
  });

  it("statusline route refuses a non-JSON content type with 415", async () => {
    const calls: unknown[] = [];
    const { port, close } = await startWithStatusLine((k) => calls.push(k));
    const res = await postStatus(port, { jarvis_session: "s1" }, "text/plain");
    expect(res.status).toBe(415);
    expect(calls).toHaveLength(0);
    close();
  });
});

describe("SessionStart on /event", () => {
  it("hands the new transcript to onSessionStart and reports no status", async () => {
    const started: unknown[] = [];
    const statuses: unknown[] = [];
    const server = startListener(
      0,
      () => undefined,
      (s) => statuses.push(s),
      () => workspaces,
      stubOrchestrator(),
      undefined,
      undefined,
      (s) => started.push(s),
    );
    await new Promise((r) => server.once("listening", r));
    const { port } = server.address() as AddressInfo;
    await post(port, {
      hook_event_name: "SessionStart",
      session_id: "s-new",
      cwd: "D:\\vault",
      transcript_path: "C:/t/s-new.jsonl",
      source: "resume",
    });
    await vi.waitFor(() => expect(started).toHaveLength(1));
    expect(started[0]).toEqual({
      sessionKey: workspaces[0].id,
      transcriptPath: "C:/t/s-new.jsonl",
      fromApp: false,
    });
    expect(statuses).toEqual([]);
    server.close();
  });
});

describe("the auto-answer reply", () => {
  const readEvent = {
    session_id: "s1",
    cwd: "D:\\vault",
    hook_event_name: "PreToolUse",
    tool_name: "Read",
    tool_input: { file_path: "D:\\vault\\notes\\beta.md" },
  };
  const askEvent = {
    session_id: "s1",
    cwd: "D:\\vault",
    hook_event_name: "PreToolUse",
    tool_name: "AskUserQuestion",
    tool_input: {
      questions: [{ question: "Which?", header: "H", options: [] }],
    },
  };

  async function startWith(autoAnswer: (raw: unknown) => unknown) {
    const events: ToolEvent[] = [];
    const statuses: StatusEvent[] = [];
    const asks: unknown[] = [];
    const server = startListener(
      0,
      (e) => events.push(e),
      (s) => statuses.push(s),
      () => workspaces,
      stubOrchestrator(),
      (p) => asks.push(p),
      undefined,
      undefined,
      autoAnswer,
    );
    await new Promise((r) => server.once("listening", r));
    const { port } = server.address() as AddressInfo;
    return { port, events, statuses, asks, close: () => server.close() };
  }

  it("replies with the hook output when autoAnswer answers", async () => {
    const answer = { hookSpecificOutput: { permissionDecision: "allow" } };
    const s = await startWith(() => answer);
    const res = await post(s.port, readEvent);
    expect(JSON.parse(await res.text())).toEqual(answer);
    await vi.waitFor(() => expect(s.events).toHaveLength(1));
    expect(s.statuses).toHaveLength(1);
    expect(s.asks).toEqual([]);
    s.close();
  });

  it("an answered AskUserQuestion still reaches onStatus and onAsk", async () => {
    const s = await startWith(() => ({ a: 1 }));
    await post(s.port, askEvent);
    await vi.waitFor(() => expect(s.asks).toHaveLength(1));
    expect(s.statuses).toHaveLength(1);
    expect(s.statuses[0]).toMatchObject({ kind: "asking" });
    expect((s.asks[0] as { questions: unknown[] }).questions).toHaveLength(1);
    s.close();
  });

  it("marks an answered AskUserQuestion as offered", async () => {
    const s = await startWith(() => ({ a: 1 }));
    await post(s.port, askEvent);
    await vi.waitFor(() => expect(s.asks).toHaveLength(1));
    expect((s.asks[0] as { offered?: true }).offered).toBe(true);
    s.close();
  });

  it("leaves an unanswered ask and the clear unmarked", async () => {
    const s = await startWith(() => null);
    await post(s.port, askEvent);
    await vi.waitFor(() => expect(s.asks).toHaveLength(1));
    expect((s.asks[0] as { offered?: true }).offered).toBeUndefined();
    await post(s.port, {
      session_id: "s1",
      cwd: "D:\\vault",
      hook_event_name: "PostToolUse",
      tool_name: "AskUserQuestion",
      tool_response: { answers: { "Which?": "A" } },
    });
    await vi.waitFor(() => expect(s.asks).toHaveLength(2));
    expect((s.asks[1] as { offered?: true }).offered).toBeUndefined();
    s.close();
  });

  it("does not mark the clear when the PostToolUse is answered", async () => {
    const s = await startWith(() => ({ a: 1 }));
    await post(s.port, {
      session_id: "s1",
      cwd: "D:\\vault",
      hook_event_name: "PostToolUse",
      tool_name: "AskUserQuestion",
      tool_response: { answers: { "Which?": "A" } },
    });
    await vi.waitFor(() => expect(s.asks).toHaveLength(1));
    expect((s.asks[0] as { offered?: true }).offered).toBeUndefined();
    s.close();
  });

  it("never marks a text question", async () => {
    const s = await startWith(() => ({ a: 1 }));
    await post(s.port, {
      session_id: "s1",
      cwd: "D:\\vault",
      hook_event_name: "Stop",
      last_assistant_message: "Which one?\n\n1. Fast\n2. Safe",
    });
    await vi.waitFor(() => expect(s.asks).toHaveLength(1));
    expect((s.asks[0] as { source: string }).source).toBe("text");
    expect((s.asks[0] as { offered?: true }).offered).toBeUndefined();
    s.close();
  });

  it("clears the panel when a Stop carries no question", async () => {
    const s = await startWith(() => ({ a: 1 }));
    await post(s.port, {
      session_id: "s1",
      cwd: "D:\\vault",
      hook_event_name: "Stop",
      last_assistant_message: "Done.",
    });
    await vi.waitFor(() => expect(s.asks).toHaveLength(1));
    expect(s.asks[0]).toMatchObject({ source: "text", questions: [] });
    s.close();
  });

  it("replies empty when autoAnswer gives null", async () => {
    const s = await startWith(() => null);
    const res = await post(s.port, askEvent);
    expect(await res.text()).toBe("");
    await vi.waitFor(() => expect(s.asks).toHaveLength(1));
    expect(s.statuses).toHaveLength(1);
    s.close();
  });

  it("replies empty on a body that is not JSON", async () => {
    const autoAnswer = vi.fn(() => ({ a: 1 }));
    const s = await startWith(autoAnswer);
    const res = await postRaw(s.port, "{not json");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("");
    expect(autoAnswer).not.toHaveBeenCalled();
    s.close();
  });

  it("a throwing autoAnswer replies empty", async () => {
    const s = await startWith(() => {
      throw new Error("boom");
    });
    const res = await post(s.port, askEvent);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("");
    await vi.waitFor(() => expect(s.statuses).toHaveLength(1));
    s.close();
  });

  it("a PostToolUse after an answer still reaches onStatus and onAsk", async () => {
    const s = await startWith(() => null);
    await post(s.port, {
      session_id: "s1",
      cwd: "D:\\vault",
      hook_event_name: "PostToolUse",
      tool_name: "AskUserQuestion",
      tool_response: { answers: { "Which?": "A" } },
    });
    await vi.waitFor(() => expect(s.asks).toHaveLength(1));
    expect(s.statuses).toHaveLength(1);
    s.close();
  });

  it("pushes a plain-text question on a Stop that ends on one", async () => {
    const seen: Array<unknown> = [];
    const server = startListener(
      0,
      () => {
        /* no-op */
      },
      () => {
        /* no-op */
      },
      () => workspaces,
      stubOrchestrator(),
      (p) => seen.push(p),
    );
    await new Promise((r) => server.once("listening", r));
    const port = (server.address() as { port: number }).port;
    await post(port, {
      session_id: "s1",
      cwd: "D:\\vault",
      hook_event_name: "Stop",
      last_assistant_message: "Which one?\n\n1. Fast\n2. Safe",
    });
    server.close();
    expect(seen).toHaveLength(1);
    expect((seen[0] as { source: string }).source).toBe("text");
  });

  it("still reports status when the text mapper throws", async () => {
    const spy = vi
      .spyOn(textQuestion, "mapTextQuestion")
      .mockImplementation(() => {
        throw new Error("boom");
      });
    const statuses: unknown[] = [];
    const s = await start(
      () => {
        /* no-op */
      },
      (e) => statuses.push(e),
    );
    await post(s.port, {
      session_id: "s1",
      cwd: "D:\\vault",
      hook_event_name: "Stop",
      last_assistant_message: "Which one?\n\n1. Fast\n2. Safe",
    });
    s.close();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
    expect(statuses).toHaveLength(1);
  });
});

describe("startListener with an agent tag", () => {
  const codexRead = {
    ...(JSON.parse(
      readFileSync("tests/fixtures/codex/pre-bash-read.json", "utf8"),
    ) as Record<string, unknown>),
    cwd: "D:\\vault",
    jarvis_session: workspaces[0].id,
    jarvis_agent: "codex",
  };
  const codexStop = {
    ...(JSON.parse(
      readFileSync("tests/fixtures/codex/stop.json", "utf8"),
    ) as Record<string, unknown>),
    cwd: "D:\\vault",
    jarvis_session: workspaces[0].id,
    jarvis_agent: "codex",
    last_assistant_message: "Which one?\n\n1. Fast\n2. Safe",
  };

  async function startTagged(autoAnswer?: (raw: unknown) => unknown) {
    const events: ToolEvent[] = [];
    const statuses: StatusEvent[] = [];
    const asks: unknown[] = [];
    const hooks: Array<[string, string]> = [];
    const server = startListener(
      0,
      (e) => events.push(e),
      (s) => statuses.push(s),
      () => workspaces,
      stubOrchestrator(),
      (p) => asks.push(p),
      undefined,
      undefined,
      autoAnswer,
      (key, name) => hooks.push([key, name]),
    );
    await new Promise((r) => server.once("listening", r));
    const { port } = server.address() as AddressInfo;
    return { port, events, statuses, asks, hooks, close: () => server.close() };
  }

  it("maps a Codex shell read to a read event", async () => {
    const s = await startTagged();
    await post(s.port, codexRead);
    await vi.waitFor(() => expect(s.events).toHaveLength(1));
    s.close();
    expect(s.events[0]).toMatchObject({ tool: "Read", nodeIds: ["README"] });
  });

  it("reports a Codex Stop that ends on a question without opening a panel", async () => {
    const s = await startTagged();
    await post(s.port, codexStop);
    await vi.waitFor(() => expect(s.statuses).toHaveLength(1));
    s.close();
    expect(s.asks).toHaveLength(0);
  });

  it("opens the panel for the same Stop without an agent tag", async () => {
    const s = await startTagged();
    const claudeStop: Record<string, unknown> = { ...codexStop };
    delete claudeStop.jarvis_agent;
    await post(s.port, claudeStop);
    await vi.waitFor(() => expect(s.statuses).toHaveLength(1));
    s.close();
    expect(s.asks).toHaveLength(1);
  });

  it("never asks autoAnswer about a Codex body", async () => {
    const autoAnswer = vi.fn(() => ({ a: 1 }));
    const s = await startTagged(autoAnswer);
    const res = await post(s.port, codexRead);
    expect(await res.text()).toBe("");
    s.close();
    expect(autoAnswer).not.toHaveBeenCalled();
  });

  it("asks autoAnswer about a body tagged claude, as about an untagged one", async () => {
    const answer = { hookSpecificOutput: { permissionDecision: "allow" } };
    const autoAnswer = vi.fn(() => answer);
    const s = await startTagged(autoAnswer);
    const res = await post(s.port, {
      session_id: "s1",
      cwd: "D:\\vault",
      hook_event_name: "PreToolUse",
      tool_name: "Read",
      tool_input: { file_path: "D:\\vault\\notes\\beta.md" },
      jarvis_agent: "claude",
    });
    expect(JSON.parse(await res.text())).toEqual(answer);
    s.close();
    expect(autoAnswer).toHaveBeenCalledTimes(1);
  });

  it("opens the panel for the same Stop tagged claude", async () => {
    const s = await startTagged();
    await post(s.port, { ...codexStop, jarvis_agent: "claude" });
    await vi.waitFor(() => expect(s.statuses).toHaveLength(1));
    s.close();
    expect(s.asks).toHaveLength(1);
    expect((s.asks[0] as { source: string }).source).toBe("text");
  });

  it("hands onHook the session key and the event name", async () => {
    const s = await startTagged();
    await post(s.port, codexRead);
    await vi.waitFor(() => expect(s.hooks).toHaveLength(1));
    s.close();
    expect(s.hooks[0]).toEqual([workspaces[0].id, "PreToolUse"]);
  });

  it("maps nothing for a JSON body that is not an object", async () => {
    const s = await startTagged();
    const res = await postRaw(s.port, "[1,2]");
    expect(res.status).toBe(200);
    await postRaw(s.port, "null");
    s.close();
    expect(s.events).toHaveLength(0);
    expect(s.statuses).toHaveLength(0);
    expect(s.hooks).toHaveLength(0);
  });
});

describe("startListener with an adapter's optional members", () => {
  const key = workspaces[0].id;
  const realAgentById = agents.agentById;

  async function startStubbed(members: Partial<AgentAdapter>) {
    const normalized: Array<Record<string, unknown>> = [];
    const stub: AgentAdapter = {
      id: "antigravity",
      features: {
        transcript: false,
        askPanel: false,
        permissionCard: false,
        statusLine: false,
        slashList: false,
        trustCheck: false,
        resume: false,
      },
      command: () => Promise.resolve(null),
      prepare: () => Promise.resolve(true),
      normalize: (raw) => {
        normalized.push(raw);
        return [];
      },
      ...members,
    };
    const spy = vi
      .spyOn(agents, "agentById")
      .mockImplementation((id) => (id === "stub" ? stub : realAgentById(id)));
    const hooks: Array<[string, string]> = [];
    const server = startListener(
      0,
      () => undefined,
      () => undefined,
      () => workspaces,
      stubOrchestrator(),
      undefined,
      undefined,
      undefined,
      undefined,
      (sessionKey, name) => hooks.push([sessionKey, name]),
    );
    await new Promise((r) => server.once("listening", r));
    const { port } = server.address() as AddressInfo;
    return {
      port,
      hooks,
      normalized,
      close: () => {
        server.close();
        spy.mockRestore();
      },
    };
  }

  it("notes the gate with the name gateEvent gives a body that has none", async () => {
    const s = await startStubbed({ gateEvent: () => "UserPromptSubmit" });
    await post(s.port, { jarvis_agent: "stub", jarvis_session: key });
    await vi.waitFor(() => expect(s.hooks).toHaveLength(1));
    s.close();
    expect(s.hooks[0]).toEqual([key, "UserPromptSubmit"]);
  });

  it("hands normalize what enrich added", async () => {
    const s = await startStubbed({
      enrich: (raw) => Promise.resolve({ ...raw, extra: 1 }),
    });
    await post(s.port, { jarvis_agent: "stub", step: 4 });
    await vi.waitFor(() => expect(s.normalized).toHaveLength(1));
    s.close();
    expect(s.normalized[0]).toEqual({
      jarvis_agent: "stub",
      step: 4,
      extra: 1,
    });
  });

  it("normalizes the original body when enrich rejects", async () => {
    const s = await startStubbed({
      enrich: () => Promise.reject(new Error("no transcript")),
    });
    await post(s.port, { jarvis_agent: "stub", step: 4 });
    await vi.waitFor(() => expect(s.normalized).toHaveLength(1));
    s.close();
    expect(s.normalized[0]).toEqual({ jarvis_agent: "stub", step: 4 });
  });

  it("replies before enrich resolves", async () => {
    let finish: (raw: Record<string, unknown>) => void = () => undefined;
    const s = await startStubbed({
      enrich: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    });
    const res = await post(s.port, { jarvis_agent: "stub" });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("");
    expect(s.normalized).toHaveLength(0);
    finish({ jarvis_agent: "stub", extra: 1 });
    await vi.waitFor(() => expect(s.normalized).toHaveLength(1));
    s.close();
    expect(s.normalized[0]).toEqual({ jarvis_agent: "stub", extra: 1 });
  });

  it("notes the gate for a Codex body with its raw hook_event_name", async () => {
    const s = await startStubbed({ gateEvent: () => "UserPromptSubmit" });
    await post(s.port, {
      hook_event_name: "Stop",
      cwd: "D:\vault",
      jarvis_session: key,
      jarvis_agent: "codex",
    });
    await vi.waitFor(() => expect(s.hooks).toHaveLength(1));
    s.close();
    expect(s.hooks[0]).toEqual([key, "Stop"]);
  });
});
