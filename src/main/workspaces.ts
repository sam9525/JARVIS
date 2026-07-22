import { promises as fs } from "node:fs";
import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";
import type { Workspace } from "../shared/types";

export interface RegistryEntry {
  name?: unknown;
  path?: unknown;
}

// Workspace ids double as path-prefix match keys: absolute, POSIX separators,
// lowercased (Windows paths are case-insensitive).
export function normalizeId(p: string): string {
  return path.resolve(p).split(path.sep).join("/").toLowerCase();
}

export function buildWorkspaces(
  vaultPath: string,
  entries: RegistryEntry[],
  extraPaths: string[] = [],
): Workspace[] {
  const vault: Workspace = {
    id: normalizeId(vaultPath),
    name: path.basename(vaultPath),
    rootPath: vaultPath,
    kind: "vault",
  };
  const code = entries
    .filter(
      (e): e is { name: string; path: string } =>
        typeof e?.name === "string" &&
        e.name !== "" &&
        typeof e?.path === "string" &&
        normalizeId(e.path) !== vault.id,
    )
    .map((e) => ({
      id: normalizeId(e.path),
      name: e.name,
      rootPath: e.path,
      kind: "code" as const,
    }));

  // Registry entries win: gitnexus picks the registered name itself, and only
  // that name can load a graph. An extra at the same path is the same project.
  const taken = new Set([vault.id, ...code.map((w) => w.id)]);
  const extra: Workspace[] = [];
  for (const p of extraPaths) {
    const id = normalizeId(p);
    if (taken.has(id)) continue;
    taken.add(id);
    extra.push({ id, name: path.basename(p), rootPath: p, kind: "code" });
  }

  return [vault, ...code, ...extra];
}

export function resolveWorkspace(
  workspaces: Workspace[],
  absPath: string,
): Workspace | null {
  const p = normalizeId(absPath);
  let best: Workspace | null = null;
  for (const ws of workspaces) {
    if (p === ws.id || p.startsWith(ws.id + "/")) {
      if (!best || ws.id.length > best.id.length) best = ws;
    }
  }
  return best;
}

export function isStale(metaJson: string | null, head: string | null): boolean {
  if (!metaJson || !head) return false;
  try {
    const last = (JSON.parse(metaJson) as { lastCommit?: unknown }).lastCommit;
    return typeof last === "string" && last !== head;
  } catch {
    return false;
  }
}

function gitHead(root: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(
      "git",
      ["-C", root, "rev-parse", "HEAD"],
      { windowsHide: true },
      (err, stdout) => resolve(err ? null : stdout.trim()),
    );
  });
}

export async function loadWorkspaces(vaultPath: string): Promise<Workspace[]> {
  const registryPath = path.join(os.homedir(), ".gitnexus", "registry.json");
  let entries: RegistryEntry[] = [];
  try {
    const parsed = JSON.parse(await fs.readFile(registryPath, "utf8"));
    if (Array.isArray(parsed)) entries = parsed;
  } catch {
    // no gitnexus / unreadable registry → vault-only (v1 mode)
  }
  const list = buildWorkspaces(vaultPath, entries);
  const alive: Workspace[] = [];
  for (const ws of list) {
    if (ws.kind === "vault") {
      alive.push(ws);
      continue;
    }
    const ok = await fs.stat(ws.rootPath).then(
      (s) => s.isDirectory(),
      () => false,
    );
    if (!ok) continue; // registry entry whose folder is gone
    const meta = await fs
      .readFile(path.join(ws.rootPath, ".gitnexus", "meta.json"), "utf8")
      .catch(() => null);
    ws.staleIndex = isStale(meta, await gitHead(ws.rootPath));
    alive.push(ws);
  }
  return alive;
}
