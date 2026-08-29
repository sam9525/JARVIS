import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  headsDir,
  importHead,
  listHeads,
  readHead,
  safeName,
} from "../../src/main/head-models";

let dir: string;
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "jarvis-heads-"));
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

const write = async (name: string, body = "glb") => {
  const p = path.join(dir, name);
  await fs.writeFile(p, body);
  return p;
};

describe("safeName", () => {
  it("keeps a plain name", () => {
    expect(safeName("helmet.glb")).toBe("helmet.glb");
  });

  it("strips any path, so a name cannot walk out of the folder", () => {
    expect(safeName("../../etc/passwd.glb")).toBe("passwd.glb");
  });

  it("reduces a Windows path to its basename, and never leaks a separator", () => {
    const name = safeName("C:\\Users\\me\\head.glb");
    expect(name.includes("/")).toBe(false);
    expect(name.includes("\\")).toBe(false);
    expect(name.endsWith(".glb")).toBe(true);
  });

  it("replaces characters a file name has no business holding", () => {
    expect(safeName("my head (2).glb")).toBe("my_head_2_.glb");
  });

  it("adds the extension when it is missing", () => {
    expect(safeName("head")).toBe("head.glb");
  });
});

describe("listHeads", () => {
  it("is empty before anything is uploaded", async () => {
    await expect(listHeads(dir)).resolves.toEqual([]);
  });

  it("lists only .glb files, sorted", async () => {
    await fs.mkdir(headsDir(dir));
    for (const n of ["b.glb", "a.glb", "notes.txt"])
      await fs.writeFile(path.join(headsDir(dir), n), "x");
    await expect(listHeads(dir)).resolves.toEqual(["a.glb", "b.glb"]);
  });
});

describe("importHead", () => {
  it("copies the picked file in and answers with its stored name", async () => {
    const src = await write("Iron Man.glb", "bytes");
    await expect(importHead(dir, src)).resolves.toBe("Iron_Man.glb");
    await expect(listHeads(dir)).resolves.toEqual(["Iron_Man.glb"]);
  });

  it("creates the folder on the first upload", async () => {
    await importHead(dir, await write("first.glb"));
    await expect(fs.stat(headsDir(dir))).resolves.toBeTruthy();
  });

  it("replaces a model uploaded under the same name", async () => {
    await importHead(dir, await write("head.glb", "one"));
    const second = path.join(dir, "again", "head.glb");
    await fs.mkdir(path.dirname(second));
    await fs.writeFile(second, "two");
    await importHead(dir, second);
    await expect(listHeads(dir)).resolves.toEqual(["head.glb"]);
    expect(await readHead(dir, "head.glb")).toEqual(
      new Uint8Array(Buffer.from("two")),
    );
  });
});

describe("readHead", () => {
  it("returns the bytes of an uploaded model", async () => {
    await importHead(dir, await write("head.glb", "bytes"));
    expect(await readHead(dir, "head.glb")).toEqual(
      new Uint8Array(Buffer.from("bytes")),
    );
  });

  it("answers null for a model that is gone, rather than throwing", async () => {
    await expect(readHead(dir, "missing.glb")).resolves.toBeNull();
  });

  it("refuses to read outside the folder", async () => {
    await fs.writeFile(path.join(dir, "secret.glb"), "no");
    await expect(readHead(dir, "../secret.glb")).resolves.toBeNull();
  });
});
