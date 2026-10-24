import { promises as fs } from "node:fs";
import { normalizeId } from "./workspaces";
import type { Workspace } from "../shared/types";

export const SCRATCH_NAME = "Scratch";

/** The workspace for jobs that belong to no project. `kind: "vault"` keeps it
 * out of worktrees and indexing; not being `isSelf` keeps the MCP tools away
 * from it, as from any delegate. */
export function scratchWorkspace(rootPath: string): Workspace {
  return {
    id: normalizeId(rootPath),
    name: SCRATCH_NAME,
    rootPath,
    kind: "vault",
    sourceId: "unknown",
    isScratch: true,
  };
}

/** The folder is a session's cwd, so it must exist before a launch. Nothing is
 * written into it: the job prompt carries everything the session needs. */
export async function ensureScratch(rootPath: string): Promise<void> {
  await fs.mkdir(rootPath, { recursive: true });
}
