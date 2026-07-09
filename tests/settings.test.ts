import { describe, it, expect } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { loadSettings, saveSettings } from "../src/main/settings";
import { defaultSettings } from "../src/shared/types";

async function tmpFile(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "jarvis-settings-"));
  return path.join(dir, "jarvis-settings.json");
}

describe("settings", () => {
  it("round-trips save → load", async () => {
    const file = await tmpFile();
    const s = {
      ...defaultSettings(),
      sectionFilter: "raw" as const,
      showTags: false,
      groups: [{ query: "tech", color: "#aa00ff" }],
      display: { textFadeThreshold: 5, nodeSize: 2, linkThickness: 1.5 },
      forces: {
        centerStrength: 0.5,
        repelStrength: 60,
        linkStrength: 1.2,
        linkDistance: 50,
      },
    };
    await saveSettings(file, s);
    expect(await loadSettings(file)).toEqual(s);
  });

  it("returns defaults when the file is missing", async () => {
    const file = await tmpFile(); // never written
    expect(await loadSettings(file)).toEqual(defaultSettings());
  });

  it("returns defaults when the file is corrupt", async () => {
    const file = await tmpFile();
    await fs.writeFile(file, "not json{{{", "utf8");
    expect(await loadSettings(file)).toEqual(defaultSettings());
  });

  it("fills defaults for fields missing from an old settings file", async () => {
    const file = await tmpFile();
    await fs.writeFile(
      file,
      JSON.stringify({ sectionFilter: "raw", domainColors: { a: "#111111" } }),
      "utf8",
    );
    // stray keys from old settings files (domainColors) are ignored entirely
    expect(await loadSettings(file)).toEqual({
      ...defaultSettings(),
      sectionFilter: "raw",
    });
  });

  it("sanitizes bad field values instead of crashing", async () => {
    const file = await tmpFile();
    await fs.writeFile(
      file,
      JSON.stringify({
        sectionFilter: "bogus",
        domainColors: { a: 5 },
        showTags: "yes",
        groups: [{ query: "ok", color: "#123456" }, { query: 7 }, "junk"],
        display: { textFadeThreshold: "big", nodeSize: 2 },
        forces: { repelStrength: null, linkDistance: 80 },
      }),
      "utf8",
    );
    const expected = defaultSettings();
    expected.groups = [{ query: "ok", color: "#123456" }];
    expected.display.nodeSize = 2;
    expected.forces.linkDistance = 80;
    expect(await loadSettings(file)).toEqual(expected);
  });
});
