import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { savePastedImage } from "../../src/main/pasted-images";

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "jarvis-paste-"));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true, maxRetries: 5 });
});

describe("savePastedImage", () => {
  it("writes the bytes and returns the path", async () => {
    const target = path.join(dir, "nested");
    const file = await savePastedImage(
      target,
      new Uint8Array([1, 2, 3]),
      "png",
      42,
    );
    expect(file).toBe(path.join(target, "pasted-42.png"));
    expect([...(await fs.readFile(file))]).toEqual([1, 2, 3]);
  });

  it("refuses a file over 20 MiB", async () => {
    await expect(
      savePastedImage(dir, new Uint8Array(20 * 1024 * 1024 + 1), "jpg", 1),
    ).rejects.toThrow();
    expect(await fs.readdir(dir)).toEqual([]);
  });
});
