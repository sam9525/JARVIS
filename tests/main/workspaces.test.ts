import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildWorkspaces,
  isStale,
  nameFromRegistry,
  normalizeId,
  readProjects,
  resolveWorkspace,
  saveProjects,
} from "../../src/main/workspaces";

const entries = [
  { name: "alpha", path: "D:\\data\\Program\\alpha" },
  { name: "vault-dup", path: "D:\\Vault" }, // same folder as the vault
  { name: "", path: "D:\\bad" }, // malformed → dropped
];

describe("buildWorkspaces", () => {
  it("puts the vault first and dedupes registry entries at the vault path", () => {
    const list = buildWorkspaces("D:\\Vault", entries);
    expect(list.map((w) => w.name)).toEqual(["Vault", "alpha"]);
    expect(list[0].kind).toBe("vault");
    expect(list[1].kind).toBe("code");
    expect(list[1].id).toBe(normalizeId("D:\\data\\Program\\alpha"));
  });

  it("returns vault-only when the registry is empty", () => {
    const list = buildWorkspaces("D:\\Vault", []);
    expect(list).toHaveLength(1);
    expect(list[0].kind).toBe("vault");
  });

  it("appends extra project paths as code workspaces named by folder", () => {
    const list = buildWorkspaces("D:\\Vault", [], ["D:\\data\\Program\\fresh"]);
    expect(list.map((w) => w.name)).toEqual(["Vault", "fresh"]);
    expect(list[1].kind).toBe("code");
    expect(list[1].id).toBe(normalizeId("D:\\data\\Program\\fresh"));
    expect(list[1].rootPath).toBe("D:\\data\\Program\\fresh");
  });

  it("lets a registry entry win over an extra at the same path", () => {
    // gitnexus names a repo itself, and that name need not match the folder —
    // the registry entry is the one that can load a graph.
    const list = buildWorkspaces(
      "D:\\Vault",
      [{ name: "AeroGraph", path: "D:\\data\\Program\\aerograph" }],
      ["d:/data/program/AEROGRAPH"],
    );
    expect(list.map((w) => w.name)).toEqual(["Vault", "AeroGraph"]);
  });

  it("drops an extra that points at the vault, and dedupes repeated extras", () => {
    const list = buildWorkspaces(
      "D:\\Vault",
      [],
      ["D:\\Vault", "D:\\proj\\a", "d:\\PROJ\\a"],
    );
    expect(list.map((w) => w.name)).toEqual(["Vault", "a"]);
  });
});

describe("resolveWorkspace", () => {
  const list = buildWorkspaces("D:\\Vault", [
    { name: "alpha", path: "D:\\proj\\alpha" },
    { name: "alpha-sub", path: "D:\\proj\\alpha\\packages\\sub" },
  ]);

  it("matches by longest prefix, case-insensitively", () => {
    expect(resolveWorkspace(list, "d:\\PROJ\\alpha\\src\\x.ts")?.name).toBe(
      "alpha",
    );
    expect(
      resolveWorkspace(list, "D:\\proj\\alpha\\packages\\sub\\y.ts")?.name,
    ).toBe("alpha-sub");
    expect(resolveWorkspace(list, "D:\\Vault\\notes\\a.md")?.kind).toBe(
      "vault",
    );
  });

  it("requires a separator boundary and returns null on no match", () => {
    // "D:\proj\alphabet" must NOT match workspace "D:\proj\alpha"
    expect(resolveWorkspace(list, "D:\\proj\\alphabet\\z.ts")).toBeNull();
    expect(resolveWorkspace(list, "C:\\elsewhere\\z.ts")).toBeNull();
  });
});

describe("isStale", () => {
  const meta = JSON.stringify({ lastCommit: "abc123" });
  it("is stale only when both sides are known and differ", () => {
    expect(isStale(meta, "def456")).toBe(true);
    expect(isStale(meta, "abc123")).toBe(false);
    expect(isStale(null, "abc123")).toBe(false); // no meta → can't judge
    expect(isStale(meta, null)).toBe(false); // git failed → don't cry wolf
    expect(isStale("not json", "abc123")).toBe(false);
  });
});

describe("readProjects / saveProjects", () => {
  it("round-trips a path list", async () => {
    const file = path.join(
      await fs.mkdtemp(path.join(os.tmpdir(), "jarvis-proj-")),
      "jarvis-projects.json",
    );
    await saveProjects(file, ["D:\\a", "D:\\b"]);
    expect(await readProjects(file)).toEqual(["D:\\a", "D:\\b"]);
  });

  it("treats a missing, unparseable, or non-array file as empty", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "jarvis-proj-"));
    expect(await readProjects(path.join(dir, "nope.json"))).toEqual([]);

    const bad = path.join(dir, "bad.json");
    await fs.writeFile(bad, "{not json", "utf8");
    expect(await readProjects(bad)).toEqual([]);

    const obj = path.join(dir, "obj.json");
    await fs.writeFile(obj, '{"a":1}', "utf8");
    expect(await readProjects(obj)).toEqual([]);
  });

  it("drops non-string entries rather than failing the whole file", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "jarvis-proj-"));
    const file = path.join(dir, "mixed.json");
    await fs.writeFile(file, '["D:\\\\a", 7, null, "D:\\\\b"]', "utf8");
    expect(await readProjects(file)).toEqual(["D:\\a", "D:\\b"]);
  });
});

describe("nameFromRegistry", () => {
  const registry = JSON.stringify([
    { name: "AeroGraph", path: "D:\\data\\Program\\aerograph" },
    { name: "alpha", path: "D:\\proj\\alpha" },
  ]);

  it("finds the registered name by normalized path", () => {
    expect(nameFromRegistry(registry, "d:/DATA/program/AeroGraph")).toBe(
      "AeroGraph",
    );
  });

  it("returns null when the path is absent or the file is unusable", () => {
    expect(nameFromRegistry(registry, "D:\\proj\\nope")).toBeNull();
    expect(nameFromRegistry(null, "D:\\proj\\alpha")).toBeNull();
    expect(nameFromRegistry("not json", "D:\\proj\\alpha")).toBeNull();
  });
});
