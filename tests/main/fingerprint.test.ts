import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { gitnexusSource } from "../../src/main/graph-sources/gitnexus-source";
import { graphifySource } from "../../src/main/graph-sources/graphify-source";
import { vaultSource } from "../../src/main/graph-sources/vault-source";
import type { Workspace } from "../../src/shared/types";

let root: string;
const ws = (): Workspace => ({
  id: "w",
  name: "w",
  rootPath: root,
  kind: "code",
  sourceId: "x",
});

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "fp-"));
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe("fingerprint", () => {
  it("gitnexus reads lastCommit and indexedAt from meta.json", async () => {
    await fs.mkdir(path.join(root, ".gitnexus"));
    await fs.writeFile(
      path.join(root, ".gitnexus", "meta.json"),
      JSON.stringify({ lastCommit: "abc", indexedAt: "2026-01-01" }),
    );
    expect(await gitnexusSource.fingerprint!(ws())).toBe(
      "gitnexus:abc:2026-01-01",
    );
  });

  it("gitnexus falls back to the stat of meta.json", async () => {
    await fs.mkdir(path.join(root, ".gitnexus"));
    const meta = path.join(root, ".gitnexus", "meta.json");
    await fs.writeFile(meta, "{}");
    const st = await fs.stat(meta);
    expect(await gitnexusSource.fingerprint!(ws())).toBe(
      `gitnexus:${st.mtimeMs}:${st.size}`,
    );
  });

  it("gitnexus without meta.json is null", async () => {
    expect(await gitnexusSource.fingerprint!(ws())).toBeNull();
  });

  it("graphify uses the stat of graph.json", async () => {
    await fs.mkdir(path.join(root, "graphify-out"));
    const g = path.join(root, "graphify-out", "graph.json");
    await fs.writeFile(g, "{}");
    const st = await fs.stat(g);
    expect(await graphifySource.fingerprint!(ws())).toBe(
      `graphify:${st.mtimeMs}:${st.size}`,
    );
  });

  it("vault changes with an .md mtime, not with other files", async () => {
    const dir = path.join(root, "dom", "wiki");
    await fs.mkdir(dir, { recursive: true });
    const note = path.join(dir, "a.md");
    await fs.writeFile(note, "x");
    const other = path.join(dir, "b.txt");
    await fs.writeFile(other, "x");
    const base = await vaultSource.fingerprint!(ws());
    expect(base).toMatch(/^vault:[0-9a-f]{40}$/);
    await fs.utimes(other, new Date(1000), new Date(1000));
    expect(await vaultSource.fingerprint!(ws())).toBe(base);
    await fs.utimes(note, new Date(5000), new Date(5000));
    expect(await vaultSource.fingerprint!(ws())).not.toBe(base);
  });
});
