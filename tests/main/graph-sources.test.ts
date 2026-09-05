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
  sourceId: UNKNOWN_SOURCE_ID,
  ...over,
});

describe("registry", () => {
  it("registers vault, then gitnexus, then graphify", () => {
    expect(SOURCES.map((s) => s.id)).toEqual(["vault", "gitnexus", "graphify"]);
  });

  it("finds a source by id, and none for unknown", () => {
    expect(sourceById("gitnexus")?.id).toBe("gitnexus");
    expect(sourceById(UNKNOWN_SOURCE_ID)).toBeUndefined();
  });

  // the stale button types reindexCommand verbatim: a source that reports
  // stale without one would offer another source's command
  it("gives every stale-reporting source its own reindex command", () => {
    for (const s of SOURCES.filter((s) => s.stale)) {
      expect(s.reindexCommand).toBeTruthy();
    }
    expect(sourceById("gitnexus")?.reindexCommand).toBe("npx gitnexus analyze");
    expect(sourceById("graphify")?.reindexCommand).toBe("/graphify .");
    expect(sourceById("vault")?.reindexCommand).toBeUndefined();
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

  it("resolves a graphify-out to graphify, but gitnexus wins when both exist", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "jarvis-gs-"));
    const out = path.join(root, "graphify-out");
    await fs.mkdir(out, { recursive: true });
    await fs.writeFile(path.join(out, "graph.json"), "{}", "utf8");
    expect(await resolveSourceId(ws({ rootPath: root }))).toBe("graphify");
    // an existing gitnexus workspace must not change source on upgrade
    await fs.mkdir(path.join(root, ".gitnexus"));
    expect(await resolveSourceId(ws({ rootPath: root }))).toBe("gitnexus");
    await fs.rm(root, { recursive: true, force: true });
  });

  it("treats a throwing detect as a miss instead of failing the boot", async () => {
    const broken: GraphSource = {
      id: "broken",
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

describe("gitnexus loadSymbols", () => {
  it("is defined, and degrades to an empty graph instead of rejecting", async () => {
    const gn = sourceById("gitnexus");
    expect(gn?.loadSymbols).toBeDefined();
    // "bad name!" fails runCypher's SAFE_REPO_NAME validation before any
    // process spawns — the cheapest guaranteed failure path
    const g = await gn?.loadSymbols?.(ws({ name: "bad name!" }));
    expect(g).toEqual({ nodes: [], edges: [] });
  });
});
