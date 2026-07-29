import { exec, execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  hasIndex,
  insideGitRepo,
  loadCodeGraph,
  loadSymbolGraph,
} from "../gitnexus-graph";
import { SOURCE_LABELS } from "../../shared/types";
import type { GraphSource } from "./types";

export function isStale(metaJson: string | null, head: string | null): boolean {
  if (!metaJson || !head) return false;
  try {
    const last = (JSON.parse(metaJson) as { lastCommit?: unknown }).lastCommit;
    return typeof last === "string" && last !== head;
  } catch {
    return false;
  }
}

export function gitHead(root: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(
      "git",
      ["-C", root, "rev-parse", "HEAD"],
      { windowsHide: true },
      (err, stdout) => resolve(err ? null : stdout.trim()),
    );
  });
}

const ANALYZE_TIMEOUT_MS = 10 * 60 * 1000;

export async function runAnalyze(cwd: string): Promise<void> {
  const skipGit = (await insideGitRepo(cwd)) ? "" : " --skip-git";
  return new Promise((resolve, reject) => {
    exec(
      `gitnexus analyze${skipGit}`,
      {
        cwd,
        windowsHide: true,
        maxBuffer: 64 * 1024 * 1024,
        timeout: ANALYZE_TIMEOUT_MS,
      },
      (err, _stdout, stderr) => {
        if (!err) return resolve();
        const killed = (err as { killed?: boolean }).killed;
        reject(
          new Error(
            killed
              ? `gitnexus analyze timed out after ${ANALYZE_TIMEOUT_MS / 60000} min`
              : stderr.trim() || err.message,
          ),
        );
      },
    );
  });
}

export const gitnexusSource: GraphSource = {
  id: "gitnexus",
  label: SOURCE_LABELS.gitnexus,
  detect: (ws) => hasIndex(ws.rootPath),
  load: (ws) =>
    loadCodeGraph(ws.name).catch((err) => {
      console.error(`code graph failed for ${ws.name}:`, err);
      return { nodes: [], edges: [] };
    }),
  loadSymbols: (ws) =>
    loadSymbolGraph(ws.name).catch((err) => {
      // gitnexus format drift / unreadable index → empty graph, no crash
      console.error(`symbol graph failed for ${ws.name}:`, err);
      return { nodes: [], edges: [] };
    }),
  index: runAnalyze,
  stale: async (rootPath) => {
    const meta = await fs
      .readFile(path.join(rootPath, ".gitnexus", "meta.json"), "utf8")
      .catch(() => null);
    return isStale(meta, await gitHead(rootPath));
  },
};
