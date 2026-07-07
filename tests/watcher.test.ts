import { describe, it, expect, vi } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { watchVault } from "../src/main/watcher";
import type { VaultGraph } from "../src/shared/types";

describe("watchVault", () => {
  it(
    "rescans and emits a fresh graph when a note is added",
    { timeout: 10_000 },
    async () => {
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), "jarvis-watch-"));
      await fs.writeFile(path.join(dir, "a.md"), "# a");

      const graphs: VaultGraph[] = [];
      const watcher = watchVault(dir, (g) => graphs.push(g));
      await new Promise((r) => watcher.once("ready", r));

      await fs.writeFile(path.join(dir, "b.md"), "links [[a]]");

      await vi.waitFor(() => expect(graphs.length).toBeGreaterThan(0), {
        timeout: 8_000,
      });
      const last = graphs[graphs.length - 1];
      expect(last.nodes.map((n) => n.id).sort()).toEqual(["a", "b"]);
      expect(last.edges).toEqual([{ source: "b", target: "a" }]);

      await watcher.close();
      await fs.rm(dir, { recursive: true, force: true });
    },
  );
});
