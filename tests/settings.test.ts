import { describe, it, expect } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { loadSettings, saveSettings } from "../src/main/settings";

async function tmpFile(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "jarvis-settings-"));
  return path.join(dir, "jarvis-settings.json");
}

describe("settings", () => {
  it("round-trips save → load", async () => {
    const file = await tmpFile();
    await saveSettings(file, {
      sectionFilter: "raw",
      domainColors: { physics: "#ff0000" },
    });
    expect(await loadSettings(file)).toEqual({
      sectionFilter: "raw",
      domainColors: { physics: "#ff0000" },
    });
  });

  it("returns defaults when the file is missing", async () => {
    const file = await tmpFile(); // never written
    expect(await loadSettings(file)).toEqual({
      sectionFilter: "both",
      domainColors: {},
    });
  });

  it("returns defaults when the file is corrupt", async () => {
    const file = await tmpFile();
    await fs.writeFile(file, "not json{{{", "utf8");
    expect(await loadSettings(file)).toEqual({
      sectionFilter: "both",
      domainColors: {},
    });
  });

  it("sanitizes bad field values instead of crashing", async () => {
    const file = await tmpFile();
    await fs.writeFile(
      file,
      JSON.stringify({ sectionFilter: "bogus", domainColors: { a: 5 } }),
      "utf8",
    );
    expect(await loadSettings(file)).toEqual({
      sectionFilter: "both",
      domainColors: {},
    });
  });
});
