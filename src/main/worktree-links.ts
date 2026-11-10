import { promises as fs } from "node:fs";
import path from "node:path";

export type LinkTarget = { target: string; names: string[] };

const SHOWN_NAMES = 5;

/** Every link (symlink or Windows junction) under `dir`, never walking into one. */
export async function findLinks(dir: string): Promise<string[]> {
  const found: string[] = [];
  const walk = async (current: string, top: boolean): Promise<void> => {
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isSymbolicLink()) found.push(full);
      else if (top && entry.name === ".git") continue;
      else if (entry.isDirectory()) await walk(full, false);
    }
  };
  await walk(dir, true);
  return found;
}

export async function snapshotTargets(links: string[]): Promise<LinkTarget[]> {
  const snapshot: LinkTarget[] = [];
  for (const link of links) {
    try {
      const target = await fs.realpath(link);
      snapshot.push({ target, names: await fs.readdir(target) });
    } catch {
      // dangling link or a target that is not a folder: nothing to protect
    }
  }
  return snapshot;
}

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** Removes each link as a link; returns a message for the first one that survives. */
export async function unlinkAll(links: string[]): Promise<string | null> {
  for (const link of links) {
    try {
      try {
        await fs.unlink(link);
      } catch {
        // a directory-type link on some platforms only goes through rmdir
        await fs.rmdir(link);
      }
      const survivor = await fs.lstat(link).then(
        () => true,
        (error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT") return false;
          throw error;
        },
      );
      if (survivor) throw new Error("still present after removal");
    } catch (error) {
      return `could not remove link ${link}: ${errorMessage(error)}`;
    }
  }
  return null;
}

/** Describes entries that vanished from targets that still exist. */
export async function lostEntries(
  snapshot: LinkTarget[],
): Promise<string | null> {
  const damaged: string[] = [];
  for (const { target, names } of snapshot) {
    let now: string[];
    try {
      now = await fs.readdir(target);
    } catch {
      continue; // the target lived inside the removed worktree
    }
    const present = new Set(now);
    const lost = names.filter((name) => !present.has(name));
    if (lost.length === 0) continue;
    const shown = lost.slice(0, SHOWN_NAMES).join(", ");
    const more = lost.length > SHOWN_NAMES ? ", …" : "";
    damaged.push(`${target} lost ${lost.length} entries (${shown}${more})`);
  }
  return damaged.length > 0 ? damaged.join("; ") : null;
}
