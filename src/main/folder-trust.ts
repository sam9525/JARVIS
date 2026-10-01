import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";

type Read = (file: string) => Promise<string>;

const norm = (p: string) =>
  p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();

/**
 * Whether Claude Code has accepted its folder-trust prompt for `rootPath`,
 * read from `~/.claude.json` — a config file, not the terminal. A trusted
 * ancestor counts, so a wrong answer leans towards "trusted": that only skips
 * the trust step, while a wrong "untrusted" would send the trust keys into a
 * live composer. null means the file could not be read, and callers treat it
 * as nothing to answer.
 */
export async function isTrusted(
  rootPath: string,
  home: string = os.homedir(),
  read: Read = (f) => fs.readFile(f, "utf8"),
): Promise<boolean | null> {
  let text: string;
  try {
    text = await read(path.join(home, ".claude.json"));
  } catch (err) {
    // a fresh install has no config yet, and so trusts nothing
    return (err as NodeJS.ErrnoException).code === "ENOENT" ? false : null;
  }
  let projects: Record<string, { hasTrustDialogAccepted?: boolean }>;
  try {
    projects = JSON.parse(text).projects ?? {};
  } catch {
    return null;
  }
  const target = norm(rootPath);
  return Object.entries(projects).some(([dir, p]) => {
    const d = norm(dir);
    return (
      p?.hasTrustDialogAccepted === true &&
      (target === d || target.startsWith(d + "/"))
    );
  });
}
