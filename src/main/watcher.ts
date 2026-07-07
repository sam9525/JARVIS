import { watch, type FSWatcher } from "chokidar";
import path from "node:path";
import { scanVault } from "./vault-graph";
import type { VaultGraph } from "../shared/types";

export function watchVault(
  rootPath: string,
  onGraph: (g: VaultGraph) => void,
): FSWatcher {
  let timer: NodeJS.Timeout | null = null;
  const watcher = watch(rootPath, {
    ignoreInitial: true,
    // skip dot-dirs relative to the vault (.obsidian, .git, .claude)
    ignored: (p) => {
      if (p === rootPath) return false;
      const rel = path.relative(rootPath, p);
      return rel.split(/[\\/]/).some((seg) => seg.startsWith("."));
    },
  });
  watcher.on("all", (_event, p) => {
    if (!p.toLowerCase().endsWith(".md")) return;
    if (timer) clearTimeout(timer);
    // ponytail: debounced full rescan per change; incremental parse if vaults get huge
    timer = setTimeout(() => {
      scanVault(rootPath)
        .then(onGraph)
        .catch(() => {
          // ignore scan errors
        });
    }, 300);
  });

  const originalClose = watcher.close.bind(watcher);
  watcher.close = async () => {
    if (timer) clearTimeout(timer);
    return originalClose();
  };

  return watcher;
}