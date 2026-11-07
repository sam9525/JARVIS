import { describe, it, expect } from "vitest";
import { spawn } from "node:child_process";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AddressInfo } from "node:net";

const FORWARD = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "src",
  "hook",
  "forward.mjs",
);

function runForward(
  port: number,
  stdinBody: string,
  extraEnv: Record<string, string> = {},
): Promise<number> {
  return runForwardWithOutput(port, stdinBody, extraEnv).then((r) => r.code);
}

function runForwardWithOutput(
  port: number,
  stdinBody: string,
  extraEnv: Record<string, string> = {},
): Promise<{ code: number; stdout: string }> {
  return new Promise((resolve) => {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      JARVIS_PORT: String(port),
      ...extraEnv,
    };
    if (!("JARVIS_SESSION" in extraEnv)) delete env.JARVIS_SESSION;
    const child = spawn(process.execPath, [FORWARD], { env });
    let stdout = "";
    child.stdout.on("data", (c) => (stdout += c));
    child.stdin.end(stdinBody);
    child.on("close", (code) => resolve({ code: code ?? -1, stdout }));
  });
}

async function captureBody(
  stdinBody: string,
  extraEnv: Record<string, string>,
): Promise<string> {
  const bodies: string[] = [];
  const server = http.createServer((req, res) => {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => {
      bodies.push(b);
      res.end();
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const { port } = server.address() as AddressInfo;
  await runForward(port, stdinBody, extraEnv);
  server.close();
  return bodies[0];
}

describe("forward.mjs", () => {
  it("adds jarvis_session from JARVIS_SESSION and keeps every field", async () => {
    const body = await captureBody('{"tool_name":"Read","cwd":"d:/repo"}', {
      JARVIS_SESSION: "d:/repo#2",
    });
    expect(JSON.parse(body)).toEqual({
      tool_name: "Read",
      cwd: "d:/repo",
      jarvis_session: "d:/repo#2",
    });
  });

  it("forwards a non-JSON body unchanged", async () => {
    const body = await captureBody("not json", { JARVIS_SESSION: "d:/repo#2" });
    expect(body).toBe("not json");
  });

  it("adds no jarvis_session key without the env var", async () => {
    const body = await captureBody('{"tool_name":"Read"}', {});
    expect(JSON.parse(body)).not.toHaveProperty("jarvis_session");
  });

  it("POSTs stdin JSON unchanged to the listener and exits 0", async () => {
    const bodies: string[] = [];
    const server = http.createServer((req, res) => {
      let b = "";
      req.on("data", (c) => (b += c));
      req.on("end", () => {
        bodies.push(b);
        res.end();
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    const { port } = server.address() as AddressInfo;

    const code = await runForward(port, '{"tool_name":"Read"}');

    expect(code).toBe(0);
    expect(bodies).toEqual(['{"tool_name":"Read"}']);
    server.close();
  });

  it("still exits 0 when no listener is running", async () => {
    // port 1 → connection refused immediately
    const code = await runForward(1, '{"tool_name":"Read"}');
    expect(code).toBe(0);
  });

  async function withReply(
    reply: string,
    run: (port: number) => Promise<void>,
  ) {
    const server = http.createServer((req, res) => {
      req.resume();
      req.on("end", () => res.end(reply));
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    try {
      await run((server.address() as AddressInfo).port);
    } finally {
      server.close();
    }
  }

  it("prints a non-empty reply body to stdout", async () => {
    const reply = '{"hookSpecificOutput":{"permissionDecision":"allow"}}';
    await withReply(reply, async (port) => {
      const r = await runForwardWithOutput(port, '{"tool_name":"Read"}');
      expect(r.code).toBe(0);
      expect(r.stdout).toBe(reply);
    });
  });

  it("prints nothing for an empty reply", async () => {
    await withReply("", async (port) => {
      const r = await runForwardWithOutput(port, '{"tool_name":"Read"}');
      expect(r.code).toBe(0);
      expect(r.stdout).toBe("");
    });
  });

  it("prints nothing when the app is not running", async () => {
    const r = await runForwardWithOutput(1, '{"tool_name":"Read"}');
    expect(r.code).toBe(0);
    expect(r.stdout).toBe("");
  });
});
