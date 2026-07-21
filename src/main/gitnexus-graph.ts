import { exec } from "node:child_process";
import type { VaultGraph } from "../shared/types";

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
