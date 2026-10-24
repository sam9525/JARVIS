import { describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { ensureScratch, scratchWorkspace } from "../../src/main/scratch";

describe("scratchWorkspace", () => {
  it("is a vault-kind Scratch workspace flagged isScratch, never isSelf", () => {
    const ws = scratchWorkspace("/u/scratch");
    expect(ws.name).toBe("Scratch");
    expect(ws.kind).toBe("vault");
    expect(ws.sourceId).toBe("unknown");
    expect(ws.isScratch).toBe(true);
    expect(ws.isSelf).toBeUndefined();
    expect(ws.rootPath).toBe("/u/scratch");
  });

  it("normalizes its id like every other workspace", () => {
    expect(scratchWorkspace("D:\\UserData\\Scratch").id).toBe(
      "d:/userdata/scratch",
    );
  });
});

describe("ensureScratch", () => {
  it("creates the folder and writes nothing into it", async () => {
    const root = path.join(
      await fs.mkdtemp(path.join(os.tmpdir(), "jarvis-scratch-")),
      "scratch",
    );
    await ensureScratch(root);
    expect(await fs.readdir(root)).toEqual([]);
    await expect(ensureScratch(root)).resolves.toBeUndefined();
  });
});
