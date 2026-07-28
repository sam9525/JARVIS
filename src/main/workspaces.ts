import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { isDirectory } from "./is-directory";
import { resolveSourceId } from "./graph-sources/registry";
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

// Added projects live in their own file rather than jarvis-settings.json: the
// renderer owns settings as live state and writes the whole object back, so
// anything main appended there would be clobbered by the next save.
export async function readProjects(file: string): Promise<string[]> {
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(file, "utf8"));
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((p): p is string => typeof p === "string");
  } catch {
    return []; // missing or unreadable → no extras; rewritten on next add
  }
}

export async function saveProjects(
  file: string,
  paths: string[],
): Promise<void> {
  await fs.writeFile(file, JSON.stringify(paths, null, 2) + "\n", "utf8");
}

// gitnexus chooses the registered name itself, so after an analyze the folder
// basename we guessed at add time has to be replaced with the real one.
export function nameFromRegistry(
  registryJson: string | null,
  rootPath: string,
): string | null {
  if (!registryJson) return null;
  try {
    const parsed: unknown = JSON.parse(registryJson);
    if (!Array.isArray(parsed)) return null;
    const id = normalizeId(rootPath);
    for (const e of parsed as RegistryEntry[]) {
      if (
        typeof e?.name === "string" &&
        e.name !== "" &&
        typeof e?.path === "string" &&
        normalizeId(e.path) === id
      ) {
        return e.name;
      }
    }
    return null;
  } catch {
    return null;
  }
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
    sourceId: "unknown",
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
      sourceId: "unknown",
    }));

  // Registry entries win: gitnexus picks the registered name itself, and only
  // that name can load a graph. An extra at the same path is the same project.
  const taken = new Set([vault.id, ...code.map((w) => w.id)]);
  const extra: Workspace[] = [];
  for (const p of extraPaths) {
    const id = normalizeId(p);
    if (taken.has(id)) continue;
    taken.add(id);
    extra.push({
      id,
      name: path.basename(p),
      rootPath: p,
      kind: "code",
      sourceId: "unknown",
    });
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

export async function loadWorkspaces(
  vaultPath: string,
  extraPaths: string[] = [],
): Promise<Workspace[]> {
  const registryPath = path.join(os.homedir(), ".gitnexus", "registry.json");
  let entries: RegistryEntry[] = [];
  try {
    const parsed = JSON.parse(await fs.readFile(registryPath, "utf8"));
    if (Array.isArray(parsed)) entries = parsed;
  } catch {
    // no gitnexus / unreadable registry → vault-only (v1 mode)
  }
  const list = buildWorkspaces(vaultPath, entries, extraPaths);
  const alive: Workspace[] = [];
  for (const ws of list) {
    if (ws.kind !== "vault" && !(await isDirectory(ws.rootPath))) continue;
    ws.sourceId = await resolveSourceId(ws);
    alive.push(ws);
  }
  return alive;
}
