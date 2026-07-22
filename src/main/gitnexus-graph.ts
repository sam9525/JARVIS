import { exec } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { isDirectory } from "./is-directory";
import type { VaultGraph } from "../shared/types";

// A project that was never analyzed has no registry entry, and `gitnexus
// cypher -r <name>` resolves its name through the registry — it throws
// `Repository "X" not found. Available: …`. There is nothing to load in that
// case, so check for the index locally instead of asking the CLI.
export function hasIndex(rootPath: string): Promise<boolean> {
  return isDirectory(path.join(rootPath, ".gitnexus"));
}

// `gitnexus analyze` exits 1 with "Not inside a git repository" unless it is
// given --skip-git, so we have to know which one to pass. Walking up beats
// shelling out to git: it is one stat per level, and it accepts a `.git` file
// as well as a directory (worktrees and submodules use a file).
export async function insideGitRepo(rootPath: string): Promise<boolean> {
  let dir = path.resolve(rootPath);
  for (;;) {
    const found = await fs.stat(path.join(dir, ".git")).then(
      () => true,
      () => false,
    );
    if (found) return true;
    const parent = path.dirname(dir);
    if (parent === dir) return false; // hit the drive root
    dir = parent;
  }
}

// Informal contract with gitnexus 1.6.x: cypher CLI prints
// {"markdown": "| col |\n| --- |\n| val |", "row_count": n} — or {"error": …}.
// Pinned by tests/fixtures/gitnexus/*.json; a format change fails there first.
export function parseCypherTable(stdout: string): string[][] {
  const parsed = JSON.parse(stdout) as {
    markdown?: unknown;
    error?: unknown;
  };
  if (typeof parsed.error === "string") throw new Error(parsed.error);
  if (typeof parsed.markdown !== "string") return [];
  return parsed.markdown
    .split("\n")
    .slice(2) // header row + divider row
    .filter((l) => l.startsWith("|"))
    .map((l) =>
      l
        .replace(/^\|/, "")
        .replace(/\|$/, "")
        .split(" | ")
        .map((c) => c.trim()),
    );
}

export function buildCodeGraph(
  files: string[],
  imports: Array<[string, string]>,
): VaultGraph {
  const ids = new Set(files);
  return {
    nodes: files.map((p) => ({
      id: p,
      type: "note" as const,
      // top-level folder drives auto-coloring, same as vault domains
      domain: p.includes("/") ? p.slice(0, p.indexOf("/")) : ".",
    })),
    edges: imports
      .filter(([a, b]) => ids.has(a) && ids.has(b))
      .map(([source, target]) => ({ source, target })),
  };
}

// registry.json is hand-editable, so the name is untrusted input for the
// quoted argument below. Matches what gitnexus actually allows in a repo name.
const SAFE_REPO_NAME = /^[\w.@-]+$/;

function runCypher(repoName: string, query: string): Promise<string> {
  // exec (not execFile): `gitnexus` is a .cmd shim on Windows, which needs a
  // shell — so the name has to be validated rather than passed as an argv entry.
  if (!SAFE_REPO_NAME.test(repoName)) {
    return Promise.reject(new Error(`unsafe repo name: ${repoName}`));
  }
  const cmd = `gitnexus cypher -r "${repoName}" "${query}"`;
  return new Promise((resolve, reject) => {
    exec(
      cmd,
      { windowsHide: true, maxBuffer: 64 * 1024 * 1024 },
      (err, stdout) => (err ? reject(err) : resolve(stdout)),
    );
  });
}

export async function loadCodeGraph(repoName: string): Promise<VaultGraph> {
  const [filesOut, importsOut] = await Promise.all([
    runCypher(repoName, "MATCH (f:File) RETURN f.filePath"),
    runCypher(
      repoName,
      "MATCH (a:File)-[r:CodeRelation {type:'IMPORTS'}]->(b:File) RETURN a.filePath, b.filePath",
    ),
  ]);
  const files = parseCypherTable(filesOut).map((r) => r[0]);
  const imports = parseCypherTable(importsOut).map(
    (r) => [r[0], r[1]] as [string, string],
  );
  return buildCodeGraph(files, imports);
}
