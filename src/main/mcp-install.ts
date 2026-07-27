import { promises as fs } from "node:fs";
import path from "node:path";
import type { Workspace } from "../shared/types";

// .mcp.json goes to the vault only: one orchestrator, N delegates. A code
// workspace with jarvis_send could delegate back — the topology, not code,
// is what makes cycles impossible, so this guard is the topology.
export async function ensureMcp(
  ws: Workspace,
  mcpPath: string,
): Promise<boolean> {
  if (ws.kind !== "vault") return true; // nothing to install — not a failure
  const file = path.join(ws.rootPath, ".mcp.json");
  let config: Record<string, unknown> = {};
  const raw = await fs.readFile(file, "utf8").catch(() => null);
  if (raw !== null) {
    try {
      config = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return false; // someone else's broken file — not ours to fix
    }
  }
  if (typeof config !== "object" || config === null || Array.isArray(config)) {
    return false;
  }
  const servers = {
    ...((config.mcpServers as Record<string, unknown>) ?? {}),
    jarvis: { command: "node", args: [mcpPath] },
  };
  try {
    await fs.writeFile(
      file,
      JSON.stringify({ ...config, mcpServers: servers }, null, 2) + "\n",
    );
  } catch {
    return false; // read-only root etc. — caller still launches the terminal
  }
  return true;
}
