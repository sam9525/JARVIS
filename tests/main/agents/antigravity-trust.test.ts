import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isAntigravityTrusted } from "../../../src/main/agents/antigravity-trust";

const CWD = "C:\\work\\demo";

let home: string;

const writeSettings = async (text: string) => {
  const dir = path.join(home, ".gemini/antigravity-cli");
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "settings.json"), text);
};

const trustList = (entries: unknown[]) =>
  writeSettings(JSON.stringify({ trustedWorkspaces: entries }));

beforeEach(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), "jarvis-agy-trust-"));
});

afterEach(async () => {
  await fs.rm(home, { recursive: true, force: true });
});

describe("isAntigravityTrusted", () => {
  it("is true for a folder listed exactly", async () => {
    await trustList(["C:\\other", CWD]);
    expect(await isAntigravityTrusted(home, CWD)).toBe(true);
  });

  it.each([
    ["other case", "c:\\WORK\\Demo"],
    ["forward slashes", "C:/work/demo"],
    ["a trailing slash", "C:\\work\\demo\\"],
    ["a trailing forward slash", "C:/work/demo/"],
  ])("is true for a folder listed with %s", async (_label, entry) => {
    await trustList([entry]);
    expect(await isAntigravityTrusted(home, CWD)).toBe(true);
  });

  it("is true when the cwd itself has a trailing slash", async () => {
    await trustList([CWD]);
    expect(await isAntigravityTrusted(home, CWD + "\\")).toBe(true);
  });

  it("is false when only a parent folder is listed", async () => {
    await trustList(["C:\\work"]);
    expect(await isAntigravityTrusted(home, CWD)).toBe(false);
  });

  it("is false when only a child folder is listed", async () => {
    await trustList(["C:\\work\\demo\\src"]);
    expect(await isAntigravityTrusted(home, CWD)).toBe(false);
  });

  it("is false for a missing settings file", async () => {
    expect(await isAntigravityTrusted(home, CWD)).toBe(false);
  });

  it("is false for malformed JSON", async () => {
    await writeSettings("{ not json");
    expect(await isAntigravityTrusted(home, CWD)).toBe(false);
  });

  it.each([
    ["absent", {}],
    ["not an array", { trustedWorkspaces: CWD }],
    ["null settings", null],
  ])("is false when trustedWorkspaces is %s", async (_label, settings) => {
    await writeSettings(JSON.stringify(settings));
    expect(await isAntigravityTrusted(home, CWD)).toBe(false);
  });

  it("skips non-string entries", async () => {
    await trustList([42, null, { path: CWD }]);
    expect(await isAntigravityTrusted(home, CWD)).toBe(false);
  });

  it("still finds a string entry next to non-string ones", async () => {
    await trustList([42, CWD]);
    expect(await isAntigravityTrusted(home, CWD)).toBe(true);
  });
});
