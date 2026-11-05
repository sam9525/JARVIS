import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { collectMdFiles, scanVault } from "../vault-graph";
import type { GraphSource } from "./types";

export const vaultSource: GraphSource = {
  id: "vault",
  detect: async (ws) => ws.kind === "vault",
  load: (ws) => scanVault(ws.rootPath),
  fingerprint: async (ws) => {
    const files = await collectMdFiles(ws.rootPath).catch(() => null);
    if (!files) return null;
    const lines = await Promise.all(
      files.map(async (f) => {
        const st = await fs.stat(f.abs).catch(() => null);
        const rel = path.relative(ws.rootPath, f.abs).replace(/\\/g, "/");
        return st ? `${rel}|${st.mtimeMs}|${st.size}` : rel;
      }),
    );
    const hash = createHash("sha1")
      .update(lines.sort().join("\n"))
      .digest("hex");
    return `vault:${hash}`;
  },
};
