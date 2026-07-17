import { describe, expect, it } from "vitest";
import {
  buildWorkspaces,
  isStale,
  normalizeId,
  resolveWorkspace,
} from "../src/main/workspaces";

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
