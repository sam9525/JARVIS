import { describe, it, expect } from "vitest";
import { spawn } from "node:child_process";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AddressInfo } from "node:net";

const FORWARD = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "src",
  "hook",
  "forward.mjs",
);

function runForward(port: number, stdinBody: string): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [FORWARD], {
      env: { ...process.env, JARVIS_PORT: String(port) },
    });
    child.stdin.end(stdinBody);
    child.on("exit", (code) => resolve(code ?? -1));
  });
}

describe("forward.mjs", () => {
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
});
