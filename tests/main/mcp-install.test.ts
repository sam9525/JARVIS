import { describe, it, expect } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { ensureMcp } from "../../src/main/mcp-install";
import type { Workspace } from "../../src/shared/types";

const MCP_PATH = "D:\\app\\src\\hook\\mcp.mjs";

async function tmpVault(): Promise<Workspace> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "jarvis-mcp-"));
  return { id: root.toLowerCase(), name: "vault", rootPath: root, kind: "vault" };
}

describe("ensureMcp", () => {
  it("writes .mcp.json with the jarvis server into the vault root", async () => {
    const ws = await tmpVault();
    expect(await ensureMcp(ws, MCP_PATH)).toBe(true);
    const written = JSON.parse(
      await fs.readFile(path.join(ws.rootPath, ".mcp.json"), "utf8"),
    );
    expect(written).toEqual({
      mcpServers: { jarvis: { command: "node", args: [MCP_PATH] } },
    });
  });

  it("merges into an existing file rather than clobbering it", async () => {
    const ws = await tmpVault();
    const file = path.join(ws.rootPath, ".mcp.json");
    await fs.writeFile(
      file,
      JSON.stringify({
        mcpServers: { other: { command: "python", args: ["x.py"] } },
        somethingElse: true,
      }),
    );
    expect(await ensureMcp(ws, MCP_PATH)).toBe(true);
    const written = JSON.parse(await fs.readFile(file, "utf8"));
    expect(written.somethingElse).toBe(true);
    expect(written.mcpServers.other).toEqual({
      command: "python",
      args: ["x.py"],
    });
    expect(written.mcpServers.jarvis).toEqual({
      command: "node",
      args: [MCP_PATH],
    });
  });

  it("refuses to touch an unparseable file and reports failure", async () => {
    const ws = await tmpVault();
    const file = path.join(ws.rootPath, ".mcp.json");
    await fs.writeFile(file, "{broken");
    expect(await ensureMcp(ws, MCP_PATH)).toBe(false);
    expect(await fs.readFile(file, "utf8")).toBe("{broken"); // untouched
  });

  it("never writes to a code workspace", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "jarvis-mcp-code-"));
    const ws: Workspace = {
      id: root.toLowerCase(),
      name: "AeroGraph",
      rootPath: root,
      kind: "code",
    };
    expect(await ensureMcp(ws, MCP_PATH)).toBe(true); // nothing to do ≠ failure
    await expect(
      fs.access(path.join(root, ".mcp.json")),
    ).rejects.toThrow();
  });
});
