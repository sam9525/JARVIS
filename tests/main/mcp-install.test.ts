import { describe, it, expect } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { ensureMcp } from "../../src/main/mcp-install";
import type { Workspace } from "../../src/shared/types";

const MCP_PATH = "D:\\app\\src\\hook\\mcp.mjs";

async function tmpSelf(): Promise<Workspace> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "jarvis-mcp-"));
  return {
    id: root.toLowerCase(),
    name: "JARVIS",
    rootPath: root,
    kind: "code",
    sourceId: "gitnexus",
    isSelf: true,
  };
}

async function tmpDelegate(): Promise<Workspace> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "jarvis-mcp-code-"));
  return {
    id: root.toLowerCase(),
    name: "AeroGraph",
    rootPath: root,
    kind: "code",
    sourceId: "gitnexus",
  };
}

describe("ensureMcp", () => {
  it("writes .mcp.json with the jarvis server into the cockpit's own root", async () => {
    const ws = await tmpSelf();
    expect(await ensureMcp(ws, MCP_PATH)).toBe(true);
    const written = JSON.parse(
      await fs.readFile(path.join(ws.rootPath, ".mcp.json"), "utf8"),
    );
    expect(written).toEqual({
      mcpServers: { jarvis: { command: "node", args: [MCP_PATH] } },
    });
  });

  it("merges into an existing file rather than clobbering it", async () => {
    const ws = await tmpSelf();
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
    const ws = await tmpSelf();
    const file = path.join(ws.rootPath, ".mcp.json");
    await fs.writeFile(file, "{broken");
    expect(await ensureMcp(ws, MCP_PATH)).toBe(false);
    expect(await fs.readFile(file, "utf8")).toBe("{broken"); // untouched
  });

  it("never writes to a delegate workspace, vault or code", async () => {
    const ws = await tmpDelegate();
    expect(await ensureMcp(ws, MCP_PATH)).toBe(true); // nothing to do ≠ failure
    await expect(
      fs.access(path.join(ws.rootPath, ".mcp.json")),
    ).rejects.toThrow();

    const vault: Workspace = {
      ...ws,
      name: "Obsidian-valut",
      kind: "vault",
      sourceId: "vault",
    };
    expect(await ensureMcp(vault, MCP_PATH)).toBe(true);
    await expect(
      fs.access(path.join(ws.rootPath, ".mcp.json")),
    ).rejects.toThrow();
  });

  // an .mcp.json an earlier topology left behind hands that session a second
  // jarvis_watch, which takes over the orchestrator's single waiter slot
  it("strips our server from a workspace that is no longer the orchestrator", async () => {
    const ws = await tmpDelegate();
    const file = path.join(ws.rootPath, ".mcp.json");
    await fs.writeFile(
      file,
      JSON.stringify({
        mcpServers: {
          jarvis: { command: "node", args: [MCP_PATH] },
          other: { command: "python", args: ["x.py"] },
        },
        somethingElse: true,
      }),
    );
    expect(await ensureMcp(ws, MCP_PATH)).toBe(true);
    const written = JSON.parse(await fs.readFile(file, "utf8"));
    expect(written.mcpServers.jarvis).toBeUndefined();
    expect(written.mcpServers.other).toEqual({
      command: "python",
      args: ["x.py"],
    });
    expect(written.somethingElse).toBe(true);
  });

  it("leaves a file holding none of our servers byte-identical", async () => {
    const ws = await tmpDelegate();
    const file = path.join(ws.rootPath, ".mcp.json");
    const raw = '{"mcpServers":{"other":{"command":"python"}}}';
    await fs.writeFile(file, raw);
    expect(await ensureMcp(ws, MCP_PATH)).toBe(true);
    expect(await fs.readFile(file, "utf8")).toBe(raw);
  });

  // the file is not ours to delete — we did not create it, and mcpServers is
  // only one of its keys
  it("leaves an empty mcpServers when ours was the only entry", async () => {
    const ws = await tmpDelegate();
    const file = path.join(ws.rootPath, ".mcp.json");
    await fs.writeFile(
      file,
      JSON.stringify({ mcpServers: { jarvis: { command: "node", args: [] } } }),
    );
    expect(await ensureMcp(ws, MCP_PATH)).toBe(true);
    expect(JSON.parse(await fs.readFile(file, "utf8"))).toEqual({
      mcpServers: {},
    });
  });

  it("leaves a delegate's unparseable file alone without failing the caller", async () => {
    const ws = await tmpDelegate();
    const file = path.join(ws.rootPath, ".mcp.json");
    await fs.writeFile(file, "{broken");
    expect(await ensureMcp(ws, MCP_PATH)).toBe(true);
    expect(await fs.readFile(file, "utf8")).toBe("{broken");
  });
});
