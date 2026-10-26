import { describe, it, expect } from "vitest";
import { spawn } from "node:child_process";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AddressInfo } from "node:net";

const SCRIPT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "src",
  "hook",
  "statusline.mjs",
);

function run(
  port: number,
  stdin: string,
  env: Record<string, string> = {},
): Promise<{ code: number; stdout: string }> {
  return new Promise((resolve) => {
    const full: NodeJS.ProcessEnv = {
      ...process.env,
      JARVIS_PORT: String(port),
    };
    delete full.JARVIS_STATUSLINE;
    delete full.JARVIS_SESSION;
    Object.assign(full, env);
    const child = spawn(process.execPath, [SCRIPT], { env: full });
    let stdout = "";
    child.stdout.on("data", (c) => (stdout += c));
    child.stdin.end(stdin);
    child.on("exit", (code) => resolve({ code: code ?? -1, stdout }));
  });
}

async function withServer(
  fn: (
    port: number,
    posts: Array<{ url: string; body: string }>,
  ) => Promise<void>,
): Promise<void> {
  const posts: Array<{ url: string; body: string }> = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      posts.push({ url: req.url ?? "", body });
      res.end();
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  try {
    await fn((server.address() as AddressInfo).port, posts);
  } finally {
    server.close();
  }
}

describe("statusline.mjs", () => {
  it("posts the JSON with the session key", async () => {
    await withServer(async (port, posts) => {
      const out = await run(port, '{"model":{"display_name":"Opus"}}', {
        JARVIS_SESSION: "s7",
      });
      expect(out.code).toBe(0);
      expect(posts).toHaveLength(1);
      expect(posts[0].url).toBe("/statusline");
      expect(JSON.parse(posts[0].body)).toEqual({
        model: { display_name: "Opus" },
        jarvis_session: "s7",
      });
    });
  });

  it("prints the user command output", async () => {
    await withServer(async (port) => {
      const out = await run(port, "{}", {
        JARVIS_STATUSLINE: `node -e "process.stdout.write('hi')"`,
      });
      expect(out.code).toBe(0);
      expect(out.stdout).toBe("hi");
    });
  });

  it("prints nothing and exits 0 when the user command fails", async () => {
    await withServer(async (port) => {
      const out = await run(port, "{}", {
        JARVIS_STATUSLINE: `node -e "process.exit(3)"`,
      });
      expect(out.code).toBe(0);
      expect(out.stdout).toBe("");
    });
  });

  it("exits 0 when the app is not running", async () => {
    const out = await run(1, "{}", { JARVIS_SESSION: "s1" });
    expect(out.code).toBe(0);
  });
});
