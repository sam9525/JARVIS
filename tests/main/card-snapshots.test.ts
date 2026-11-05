import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  deleteSnapshot,
  loadFingerprinted,
  readSnapshots,
  saveSnapshot,
  snapshotFile,
} from "../../src/main/card-snapshots";
import { gitnexusSource } from "../../src/main/graph-sources/gitnexus-source";
import type { CardLayout, Workspace } from "../../src/shared/types";

let dir: string;
const wsA: Workspace = {
  id: "a",
  name: "a",
  rootPath: "/a",
  kind: "code",
  sourceId: "gitnexus",
};
const self: Workspace = { ...wsA, id: "me", isSelf: true };
const layout: CardLayout = {
  width: 10,
  height: 10,
  transform: { k: 1, x: 0, y: 0 },
  nodes: [{ id: "n", hk: "n", x: 1, y: 2, r: 3, fill: "#fff" }],
  links: [],
};
const body = { look: "l", layout, fingerprint: "f" };
const at = (fingerprint: string | undefined) => ({ ...body, fingerprint });
const fp = async () => "gitnexus:1:2";

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "snap-"));
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

const exists = (f: string) =>
  fs.stat(f).then(
    () => true,
    () => false,
  );

describe("saveSnapshot", () => {
  it("refuses unknown, isSelf, empty, oversized and unfingerprinted saves", async () => {
    expect(await saveSnapshot(dir, undefined, body)).toBe(false);
    expect(await saveSnapshot(dir, self, body)).toBe(false);
    expect(
      await saveSnapshot(dir, wsA, {
        ...body,
        layout: { ...layout, nodes: [] },
      }),
    ).toBe(false);
    expect(
      await saveSnapshot(dir, wsA, { ...body, look: "x".repeat(1024 * 1024) }),
    ).toBe(false);
    expect(await saveSnapshot(dir, wsA, at(undefined))).toBe(false);
    expect(await saveSnapshot(dir, wsA, at(""))).toBe(false);
    expect(await fs.readdir(dir)).toEqual([]);
  });

  it("refuses a layout of the wrong shape and writes nothing", async () => {
    const bad: unknown[] = [
      { ...layout, transform: undefined },
      { ...layout, transform: { k: 0, x: 0, y: 0 } },
      { ...layout, width: Number.NaN },
      { ...layout, height: 0 },
      { ...layout, nodes: [null] },
      { ...layout, nodes: [{ ...layout.nodes[0], x: "1" }] },
      { ...layout, nodes: [{ ...layout.nodes[0], fill: 3 }] },
      { ...layout, links: [[0, 1]] },
      { ...layout, links: [[0]] },
      { ...layout, links: [[0, 0.5]] },
      { ...layout, links: null },
    ];
    for (const l of bad)
      expect(
        await saveSnapshot(dir, wsA, { ...body, layout: l as CardLayout }),
      ).toBe(false);
    expect(
      await saveSnapshot(dir, wsA, { ...body, look: 3 as unknown as string }),
    ).toBe(false);
    expect(await fs.readdir(dir)).toEqual([]);
  });

  it("writes through a temporary file that does not survive", async () => {
    await Promise.all([
      saveSnapshot(dir, wsA, body),
      saveSnapshot(dir, wsA, { ...body, look: "m" }),
    ]);
    expect(await fs.readdir(dir)).toEqual([
      path.basename(snapshotFile(dir, "a")),
    ]);
  });

  it("keeps the last of many saves in flight for one card", async () => {
    const saves = Array.from({ length: 20 }, (_, i) =>
      saveSnapshot(dir, wsA, { ...body, look: String(i) }),
    );
    expect(await Promise.all(saves)).toEqual(Array(20).fill(true));
    const stored = JSON.parse(
      await fs.readFile(snapshotFile(dir, "a"), "utf8"),
    );
    expect(stored.look).toBe("19");
    expect(await fs.readdir(dir)).toHaveLength(1);
  });

  it("writes a valid body", async () => {
    expect(await saveSnapshot(dir, wsA, body)).toBe(true);
    const stored = JSON.parse(
      await fs.readFile(snapshotFile(dir, "a"), "utf8"),
    );
    expect(stored).toEqual({
      format: 1,
      id: "a",
      fingerprint: "f",
      look: "l",
      layout,
    });
    expect(await fs.readdir(dir)).toHaveLength(1);
  });
});

describe("readSnapshots", () => {
  it("returns a valid file", async () => {
    await saveSnapshot(dir, wsA, at("gitnexus:1:2"));
    const got = await readSnapshots(dir, [wsA], fp);
    expect(got.map((s) => s.id)).toEqual(["a"]);
  });

  it("returns [] when the directory is missing", async () => {
    expect(await readSnapshots(path.join(dir, "nope"), [wsA], fp)).toEqual([]);
  });

  it("deletes corrupt, old-format, orphaned and stale files", async () => {
    const wsB = { ...wsA, id: "b" };
    const wsC = { ...wsA, id: "c" };
    await fs.writeFile(snapshotFile(dir, "a"), "{trunc");
    await fs.writeFile(
      snapshotFile(dir, "b"),
      JSON.stringify({
        format: 0,
        id: "b",
        fingerprint: "gitnexus:1:2",
        look: "",
        layout,
      }),
    );
    await fs.writeFile(
      snapshotFile(dir, "gone"),
      JSON.stringify({
        format: 1,
        id: "gone",
        fingerprint: "gitnexus:1:2",
        look: "",
        layout,
      }),
    );
    await fs.writeFile(
      snapshotFile(dir, "c"),
      JSON.stringify({
        format: 1,
        id: "c",
        fingerprint: "old",
        look: "",
        layout,
      }),
    );
    expect(await readSnapshots(dir, [wsA, wsB, wsC], fp)).toEqual([]);
    expect(await fs.readdir(dir)).toEqual([]);
  });

  it("deletes a current-format file whose layout has the wrong shape", async () => {
    const shapes: unknown[] = [
      { ...layout, transform: undefined },
      { ...layout, links: [[0, 7]] },
      { ...layout, nodes: [null] },
    ];
    const list = shapes.map((_, i) => ({ ...wsA, id: `w${i}` }));
    for (const [i, l] of shapes.entries())
      await fs.writeFile(
        snapshotFile(dir, `w${i}`),
        JSON.stringify({
          format: 1,
          id: `w${i}`,
          fingerprint: "gitnexus:1:2",
          look: "",
          layout: l,
        }),
      );
    expect(await readSnapshots(dir, list, fp)).toEqual([]);
    expect(await fs.readdir(dir)).toEqual([]);
  });

  it("prunes leftover temporary files", async () => {
    await saveSnapshot(dir, wsA, at("gitnexus:1:2"));
    await fs.writeFile(`${snapshotFile(dir, "a")}.123.tmp`, "{");
    expect((await readSnapshots(dir, [wsA], fp)).map((s) => s.id)).toEqual([
      "a",
    ]);
    expect(await fs.readdir(dir)).toEqual([
      path.basename(snapshotFile(dir, "a")),
    ]);
  });

  it("a save then a delete then a read returns nothing", async () => {
    await saveSnapshot(dir, wsA, at("gitnexus:1:2"));
    await deleteSnapshot(dir, "a");
    expect(await readSnapshots(dir, [wsA], fp)).toEqual([]);
    expect(await exists(snapshotFile(dir, "a"))).toBe(false);
  });
});

describe("loadFingerprinted", () => {
  it("a save of a graph loaded before a rebuild does not survive the next read", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "snap-root-"));
    const ws = { ...wsA, rootPath: root };
    const meta = path.join(root, ".gitnexus", "meta.json");
    await fs.mkdir(path.dirname(meta));
    await fs.writeFile(
      meta,
      JSON.stringify({ lastCommit: "A", indexedAt: "1" }),
    );
    const fingerprintOf = (w: Workspace) => gitnexusSource.fingerprint!(w);
    const g = await loadFingerprinted(
      async () => ({ nodes: [], edges: [] }),
      () => fingerprintOf(ws),
    );
    expect(g.fingerprint).toBe("gitnexus:A:1");

    await fs.writeFile(
      meta,
      JSON.stringify({ lastCommit: "B", indexedAt: "2" }),
    );
    expect(
      await saveSnapshot(dir, ws, {
        look: "l",
        layout,
        fingerprint: g.fingerprint,
      }),
    ).toBe(true);
    expect(await readSnapshots(dir, [ws], fingerprintOf)).toEqual([]);
    expect(await fs.readdir(dir)).toEqual([]);
    await fs.rm(root, { recursive: true, force: true });
  });

  it("leaves a source with no fingerprint unstamped", async () => {
    const g = await loadFingerprinted(
      async () => ({ nodes: [], edges: [] }),
      async () => null,
    );
    expect("fingerprint" in g).toBe(false);
  });
});

describe("deleteSnapshot", () => {
  it("ignores a missing file", async () => {
    await expect(deleteSnapshot(dir, "a")).resolves.toBeUndefined();
  });
});
