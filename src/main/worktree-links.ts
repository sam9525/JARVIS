import { promises as fs } from "node:fs";
import path from "node:path";

export type LinkTarget = { target: string; names: string[] };

const SHOWN_NAMES = 5;
export const LINK_SCAN_CONCURRENCY = 16;

/** Every link (symlink or Windows junction) under `dir`, never walking into one. */
export async function findLinks(dir: string): Promise<string[]> {
  const found: string[] = [];
  const queue: { folder: string; top: boolean }[] = [
    { folder: dir, top: true },
  ];
  const scan = async (job: { folder: string; top: boolean }): Promise<void> => {
    const entries = await fs.readdir(job.folder, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(job.folder, entry.name);
      if (entry.isSymbolicLink()) found.push(full);
      else if (job.top && entry.name === ".git") continue;
      else if (entry.isDirectory()) queue.push({ folder: full, top: false });
    }
  };
  return new Promise((resolve, reject) => {
    let active = 0;
    let failed = false;
    // Starts queued folders until LINK_SCAN_CONCURRENCY reads are in flight;
    // each finished read pumps again, and the scan ends when nothing is queued
    // or running.
    const pump = (): void => {
      if (failed) return;
      for (let job; active < LINK_SCAN_CONCURRENCY && (job = queue.pop());) {
        active++;
        scan(job).then(
          () => {
            active--;
            pump();
          },
          (error: unknown) => {
            failed = true;
            reject(error);
          },
        );
      }
      if (active === 0 && queue.length === 0) resolve(found);
    };
    pump();
  });
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
