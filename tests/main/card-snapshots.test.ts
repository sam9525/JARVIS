import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  deleteSnapshot,
  readSnapshots,
  saveSnapshot,
  snapshotFile,
} from "../../src/main/card-snapshots";
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
const body = { look: "l", layout };
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
    expect(await saveSnapshot(dir, undefined, body, "f")).toBe(false);
    expect(await saveSnapshot(dir, self, body, "f")).toBe(false);
    expect(
      await saveSnapshot(
        dir,
        wsA,
        { look: "l", layout: { ...layout, nodes: [] } },
        "f",
      ),
    ).toBe(false);
    expect(
      await saveSnapshot(
        dir,
        wsA,
        { look: "x".repeat(1024 * 1024), layout },
        "f",
      ),
    ).toBe(false);
    expect(await saveSnapshot(dir, wsA, body, null)).toBe(false);
    expect(await fs.readdir(dir)).toEqual([]);
  });

  it("writes a valid body", async () => {
    expect(await saveSnapshot(dir, wsA, body, "f")).toBe(true);
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
    await saveSnapshot(dir, wsA, body, "gitnexus:1:2");
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

  it("a save then a delete then a read returns nothing", async () => {
    await saveSnapshot(dir, wsA, body, "gitnexus:1:2");
    await deleteSnapshot(dir, "a");
    expect(await readSnapshots(dir, [wsA], fp)).toEqual([]);
    expect(await exists(snapshotFile(dir, "a"))).toBe(false);
  });
});

describe("deleteSnapshot", () => {
  it("ignores a missing file", async () => {
    await expect(deleteSnapshot(dir, "a")).resolves.toBeUndefined();
  });
});
