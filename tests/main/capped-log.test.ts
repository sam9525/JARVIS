import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { appendCapped, LOG_CAP_BYTES } from "../../src/main/capped-log";

let dir: string;
let file: string;
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "capped-log-"));
  file = path.join(dir, "edge-tts.log");
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe("appendCapped", () => {
  it("appends timestamped lines", async () => {
    await appendCapped(file, "a", new Date("2026-10-30T00:00:00.000Z"));
    await appendCapped(file, "b", new Date("2026-10-30T00:00:01.000Z"));
    expect(await fs.readFile(file, "utf8")).toBe(
      "2026-10-30T00:00:00.000Z a\n2026-10-30T00:00:01.000Z b\n",
    );
  });

  it("starts over once the file is past the cap", async () => {
    await fs.writeFile(file, "x".repeat(LOG_CAP_BYTES + 1));
    await appendCapped(file, "fresh", new Date("2026-10-30T00:00:00.000Z"));
    expect(await fs.readFile(file, "utf8")).toBe(
      "2026-10-30T00:00:00.000Z fresh\n",
    );
  });

  it("swallows a write error", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await expect(
      appendCapped(path.join(dir, "missing", "deep", "x.log"), "a"),
    ).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
