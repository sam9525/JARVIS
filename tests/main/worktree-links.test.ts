import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  findLinks,
  lostEntries,
  snapshotTargets,
  unlinkAll,
} from "../../src/main/worktree-links";

let root: string;
const links: string[] = [];

const junction = async (target: string, link: string) => {
  await fs.symlink(target, link, "junction");
  links.push(link);
};

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "jarvis-links-"));
});

afterEach(async () => {
  for (const link of links.splice(0))
    await fs.unlink(link).catch(() => undefined);
  await fs.rm(root, { recursive: true, force: true });
});

describe("findLinks", () => {
  it("finds a junction at the top and one nested in a real folder, and does not walk into either", async () => {
    const wt = path.join(root, "wt");
    await fs.mkdir(path.join(wt, "real", "deep"), { recursive: true });
    for (const d of ["outside", "outside2", "x"]) {
      await fs.mkdir(path.join(root, d));
    }
    await junction(path.join(root, "x"), path.join(root, "outside", "inner"));
    await junction(path.join(root, "outside"), path.join(wt, "node_modules"));
    await junction(
      path.join(root, "outside2"),
      path.join(wt, "real", "deep", "link"),
    );
    const found = (await findLinks(wt)).sort();
    expect(found).toEqual(
      [
        path.join(wt, "node_modules"),
        path.join(wt, "real", "deep", "link"),
      ].sort(),
    );
  });

  it("returns a top-level .git junction", async () => {
    const wt = path.join(root, "wt");
    const outside = path.join(root, "outside");
    await fs.mkdir(wt);
    await fs.mkdir(outside);
    await junction(outside, path.join(wt, ".git"));
    expect(await findLinks(wt)).toEqual([path.join(wt, ".git")]);
  });

  it("reads at most 16 folders at once", async () => {
    const wt = path.join(root, "wt");
    for (let i = 0; i < 40; i++) {
      await fs.mkdir(path.join(wt, `dir${i}`), { recursive: true });
    }
    const realReaddir = fs.readdir.bind(fs) as (
      ...args: unknown[]
    ) => Promise<unknown>;
    let pending = 0;
    let peak = 0;
    const spy = vi.spyOn(fs, "readdir").mockImplementation((async (
      ...args: unknown[]
    ) => {
      pending++;
      peak = Math.max(peak, pending);
      await new Promise((resolve) => setTimeout(resolve, 5));
      try {
        return await realReaddir(...args);
      } finally {
        pending--;
      }
    }) as unknown as typeof fs.readdir);
    try {
      expect(await findLinks(wt)).toEqual([]);
    } finally {
      spy.mockRestore();
    }
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(16);
  });

  it("skips the .git file", async () => {
    const wt = path.join(root, "wt");
    await fs.mkdir(wt);
    await fs.writeFile(path.join(wt, ".git"), "gitdir: elsewhere");
    expect(await findLinks(wt)).toEqual([]);
  });
});

describe("snapshotTargets", () => {
  it("snapshots names in the target and nothing for a dangling link", async () => {
    const outside = path.join(root, "outside");
    const gone = path.join(root, "gone");
    await fs.mkdir(outside);
    await fs.mkdir(gone);
    await fs.writeFile(path.join(outside, "a"), "");
    await fs.writeFile(path.join(outside, ".bin"), "");
    const live = path.join(root, "live");
    const dangling = path.join(root, "dangling");
    await junction(outside, live);
    await junction(gone, dangling);
    await fs.rmdir(gone);
    const snap = await snapshotTargets([live, dangling]);
    expect(snap).toEqual([
      { target: await fs.realpath(outside), names: [".bin", "a"] },
    ]);
  });
});

describe("unlinkAll", () => {
  it("unlinks a junction and keeps the target's files", async () => {
    const outside = path.join(root, "outside");
    await fs.mkdir(outside);
    await fs.writeFile(path.join(outside, "a"), "");
    const link = path.join(root, "link");
    await junction(outside, link);
    expect(await unlinkAll([link])).toBeNull();
    await expect(fs.lstat(link)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(fs.stat(path.join(outside, "a"))).resolves.toBeDefined();
  });

  it("reports the first link it cannot remove", async () => {
    const folder = path.join(root, "real");
    await fs.mkdir(folder);
    await fs.writeFile(path.join(folder, "f"), "");
    const result = await unlinkAll([folder]);
    expect(result).toMatch(/^could not remove link /);
    expect(result).toContain(folder);
    await expect(fs.stat(path.join(folder, "f"))).resolves.toBeDefined();
  });
});

describe("lostEntries", () => {
  it("reports lost entries, capped at five names", async () => {
    const target = path.join(root, "target");
    await fs.mkdir(target);
    const names = ["n1", "n2", "n3", "n4", "n5", "n6", "n7"];
    for (const n of names) await fs.writeFile(path.join(target, n), "");
    const link = path.join(root, "link");
    await junction(target, link);
    const snap = await snapshotTargets([link]);
    for (const n of names.slice(0, 6)) await fs.rm(path.join(target, n));
    expect(await lostEntries(snap)).toBe(
      `${snap[0].target} lost 6 entries (n1, n2, n3, n4, n5, …)`,
    );
  });

  it("ignores a target that is gone entirely", async () => {
    const target = path.join(root, "target");
    await fs.mkdir(target);
    await fs.writeFile(path.join(target, "a"), "");
    const link = path.join(root, "link");
    await junction(target, link);
    const snap = await snapshotTargets([link]);
    await fs.unlink(link);
    await fs.rm(target, { recursive: true });
    expect(await lostEntries(snap)).toBeNull();
  });
});
