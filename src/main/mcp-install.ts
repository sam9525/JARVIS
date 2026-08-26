import { promises as fs } from "node:fs";
import path from "node:path";
import type { Workspace } from "../shared/types";

const SERVER = "jarvis";

const asObject = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

// A .mcp.json an earlier topology left in a delegate's root keeps handing that
// session the jarvis_* tools: orchestrate holds a single waiter slot, so a
// second jarvis_watch overwrites the orchestrator's park, and a delegate that
// is no longer isSelf can jarvis_send to itself. Foreign servers stay, and a
// file with nothing of ours in it is left byte-identical — the same shape
// hook-install uses to clean v1's entry out of a shared settings file. The
// file itself is never deleted: we did not create it, and mcpServers is only
// one of its keys.
async function removeServer(file: string): Promise<void> {
  const raw = await fs.readFile(file, "utf8").catch(() => null);
  if (raw === null) return;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return; // someone else's broken file — not ours to fix
  }
  const config = asObject(parsed);
  const servers = config && asObject(config.mcpServers);
  if (!config || !servers || !(SERVER in servers)) return;
  const rest = { ...servers };
  delete rest[SERVER];
  await fs
    .writeFile(
      file,
      JSON.stringify({ ...config, mcpServers: rest }, null, 2) + "\n",
    )
    .catch(() => undefined);
}

// .mcp.json goes to the isSelf workspace only — the main agent's folder, not
// the JARVIS repo: one orchestrator, N delegates. A second workspace holding
// jarvis_send could delegate back, so this guard is the topology, and it runs
// in both directions: every other workspace has our entry taken back out.
// isSelf is dev-only (see index.ts), which matches terminals.
export async function ensureMcp(
  ws: Workspace,
  mcpPath: string,
): Promise<boolean> {
  const file = path.join(ws.rootPath, ".mcp.json");
  if (!ws.isSelf) {
    await removeServer(file);
    return true; // nothing to install — not a failure
  }
  let config: Record<string, unknown> = {};
  const raw = await fs.readFile(file, "utf8").catch(() => null);
  if (raw !== null) {
    try {
      config = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return false; // someone else's broken file — not ours to fix
    }
  }
  if (!asObject(config)) return false;
  const servers = {
    ...((config.mcpServers as Record<string, unknown>) ?? {}),
    [SERVER]: { command: "node", args: [mcpPath] },
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
