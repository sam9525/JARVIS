import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  SOURCES,
  UNKNOWN_SOURCE_ID,
  resolveSourceId,
  sourceById,
} from "../../src/main/graph-sources/registry";
import { isStale } from "../../src/main/graph-sources/gitnexus-source";
import type { GraphSource } from "../../src/main/graph-sources/types";
import type { Workspace } from "../../src/shared/types";

const ws = (over: Partial<Workspace>): Workspace => ({
  id: "w",
  name: "w",
  rootPath: "D:\\nowhere",
  kind: "code",
  ...over,
});

describe("registry", () => {
  it("registers vault before gitnexus", () => {
    expect(SOURCES.map((s) => s.id)).toEqual(["vault", "gitnexus"]);
  });

  it("finds a source by id, and none for unknown", () => {
    expect(sourceById("gitnexus")?.label).toBe("GitNexus");
    expect(sourceById(UNKNOWN_SOURCE_ID)).toBeUndefined();
  });
});

describe("resolveSourceId", () => {
  it("resolves a vault workspace to vault without touching the fs", async () => {
    expect(await resolveSourceId(ws({ kind: "vault" }))).toBe("vault");
  });

  it("resolves an indexed repo to gitnexus and a bare folder to unknown", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "jarvis-gs-"));
    expect(await resolveSourceId(ws({ rootPath: root }))).toBe(
      UNKNOWN_SOURCE_ID,
    );
    await fs.mkdir(path.join(root, ".gitnexus"));
    expect(await resolveSourceId(ws({ rootPath: root }))).toBe("gitnexus");
    await fs.rm(root, { recursive: true, force: true });
  });

  it("treats a throwing detect as a miss instead of failing the boot", async () => {
    const broken: GraphSource = {
      id: "broken",
      label: "Broken",
      detect: () => Promise.reject(new Error("probe exploded")),
      load: () => Promise.resolve({ nodes: [], edges: [] }),
    };
    expect(await resolveSourceId(ws({}), [broken])).toBe(UNKNOWN_SOURCE_ID);
  });
});

describe("gitnexus stale", () => {
  // moved verbatim from tests/main/workspaces.test.ts — isStale lives with
  // its source now
  const meta = JSON.stringify({ lastCommit: "abc123" });
  it("is stale only when both sides are known and differ", () => {
    expect(isStale(meta, "def456")).toBe(true);
    expect(isStale(meta, "abc123")).toBe(false);
    expect(isStale(null, "abc123")).toBe(false); // no meta → can't judge
    expect(isStale(meta, null)).toBe(false); // git failed → don't cry wolf
    expect(isStale("not json", "abc123")).toBe(false);
  });

  it("stale() reads meta.json but reports false when git has no HEAD", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "jarvis-stale-"));
    await fs.mkdir(path.join(root, ".gitnexus"));
    await fs.writeFile(
      path.join(root, ".gitnexus", "meta.json"),
      JSON.stringify({ lastCommit: "abc123" }),
      "utf8",
    );
    // tmpdir is not a git repo → gitHead resolves null → never stale
    const gn = sourceById("gitnexus");
    expect(gn?.stale).toBeDefined();
    expect(await gn?.stale?.(root)).toBe(false);
    await fs.rm(root, { recursive: true, force: true });
  });
});
