import { describe, it, expect } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { loadSettings, saveSettings } from "../src/main/settings";
import { defaultSettings } from "../src/shared/types";
import type { Settings } from "../src/shared/types";

async function tmpFile(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "jarvis-settings-"));
  return path.join(dir, "jarvis-settings.json");
}

describe("settings", () => {
  it("round-trips save → load", async () => {
    const file = await tmpFile();
    const s: Settings = {
      ...defaultSettings(),
      dimensions: "3d",
      sectionFilter: "raw",
      showTags: false,
      groups: { "d:/vault": [{ query: "tech", color: "#aa00ff" }] },
      views: {
        "2d": {
          display: {
            textFadeThreshold: 5,
            nodeSize: 2,
            linkThickness: 1.5,
            nodeOpacity: 0.7,
            linkOpacity: 0.4,
            haloPad: 1.2,
            haloBase: 15,
            haloOpacity: 0.4,
            focusZoom: 2.5,
          },
          forces: {
            centerStrength: 0.5,
            repelStrength: 60,
            linkStrength: 1.2,
            linkDistance: 50,
          },
        },
        "3d": {
          display: {
            textFadeThreshold: 8,
            nodeSize: 3,
            linkThickness: 0.8,
            nodeOpacity: 0.3,
            linkOpacity: 0.15,
            haloPad: 1.5,
            haloBase: 20,
            haloOpacity: 0.8,
            focusZoom: 150,
          },
          forces: {
            centerStrength: 0.2,
            repelStrength: 12,
            linkStrength: 0.9,
            linkDistance: 90,
          },
        },
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
        groups: {
          "d:/vault": [{ query: "ok", color: "#123456" }, { query: 7 }, "junk"],
        },
        display: { textFadeThreshold: "big", nodeSize: 2 },
        forces: { repelStrength: null, linkDistance: 80 },
      }),
      "utf8",
    );
    const expected = defaultSettings();
    expected.groups = { "d:/vault": [{ query: "ok", color: "#123456" }] };
    // legacy flat display/forces migrate into BOTH views
    expected.views["2d"].display.nodeSize = 2;
    expected.views["3d"].display.nodeSize = 2;
    expected.views["2d"].forces.linkDistance = 80;
    expected.views["3d"].forces.linkDistance = 80;
    expect(await loadSettings(file)).toEqual(expected);
  });

  it("migrates a legacy flat display/forces into both views", async () => {
    const file = await tmpFile();
    await fs.writeFile(
      file,
      JSON.stringify({
        display: { nodeSize: 2.5 },
        forces: { linkDistance: 77 },
      }),
      "utf8",
    );
    const loaded = await loadSettings(file);
    expect(loaded.views["2d"].display.nodeSize).toBe(2.5);
    expect(loaded.views["3d"].display.nodeSize).toBe(2.5);
    expect(loaded.views["2d"].forces.linkDistance).toBe(77);
    expect(loaded.views["3d"].forces.linkDistance).toBe(77);
  });

  it("keeps per-view values independent, with per-view winning over legacy flat", async () => {
    const file = await tmpFile();
    await fs.writeFile(
      file,
      JSON.stringify({
        display: { nodeSize: 2 }, // legacy flat seeds both views…
        views: { "3d": { display: { nodeSize: 3 } } }, // …but 3d overrides
      }),
      "utf8",
    );
    const loaded = await loadSettings(file);
    expect(loaded.views["2d"].display.nodeSize).toBe(2);
    expect(loaded.views["3d"].display.nodeSize).toBe(3);
  });

  it("loads a persisted 3d dimension", async () => {
    const file = await tmpFile();
    await fs.writeFile(file, JSON.stringify({ dimensions: "3d" }), "utf8");
    expect((await loadSettings(file)).dimensions).toBe("3d");
  });

  it("falls back to 3d for a bad dimension value", async () => {
    const file = await tmpFile();
    await fs.writeFile(file, JSON.stringify({ dimensions: "4d" }), "utf8");
    expect((await loadSettings(file)).dimensions).toBe("3d");
  });

  it("defaults the 3d view to the tuned layout, 2d unchanged", () => {
    const s = defaultSettings();
    expect(s.views["3d"]).toEqual({
      display: {
        textFadeThreshold: 15,
        nodeSize: 0.5,
        linkThickness: 0.5,
        nodeOpacity: 0.5,
        linkOpacity: 0.25,
        haloPad: 1.1,
        haloBase: 10,
        haloOpacity: 0.55,
        focusZoom: 180,
      },
      forces: {
        centerStrength: 0.5,
        repelStrength: 20,
        linkStrength: 1,
        linkDistance: 60,
      },
    });
    expect(s.views["2d"]).toEqual({
      display: {
        textFadeThreshold: 15,
        nodeSize: 1,
        linkThickness: 1,
        nodeOpacity: 0.5,
        linkOpacity: 0.25,
        haloPad: 1.1,
        haloBase: 10,
        haloOpacity: 0.55,
        focusZoom: 6.8,
      },
      forces: {
        centerStrength: 0.5,
        repelStrength: 10,
        linkStrength: 1,
        linkDistance: 50,
      },
    });
    // fresh objects every call — loadSettings mutates these in place
    expect(defaultSettings().views["3d"].display).not.toBe(
      defaultSettings().views["3d"].display,
    );
  });

  it("keeps groups keyed per workspace id, dropping bad entries", async () => {
    const file = await tmpFile();
    await fs.writeFile(
      file,
      JSON.stringify({
        groups: {
          "d:/vault": [{ query: "physics/", color: "#112233" }],
          "d:/repo": [{ query: "src/", color: "#445566" }, "junk"],
        },
      }),
      "utf8",
    );
    expect((await loadSettings(file)).groups).toEqual({
      "d:/vault": [{ query: "physics/", color: "#112233" }],
      "d:/repo": [{ query: "src/", color: "#445566" }],
    });
  });

  it("drops a legacy flat groups array — the renderer re-seeds per workspace", async () => {
    const file = await tmpFile();
    await fs.writeFile(
      file,
      JSON.stringify({ groups: [{ query: "tech/", color: "#abcabc" }] }),
      "utf8",
    );
    expect((await loadSettings(file)).groups).toEqual({});
  });

  it("focusZoom defaults per view (2D zoom factor, 3D camera distance)", () => {
    const d = defaultSettings();
    expect(d.views["2d"].display.focusZoom).toBe(6.8);
    expect(d.views["3d"].display.focusZoom).toBe(180);
  });

  it("defaults codeGraphLevel to file and accepts a stored symbol value", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "jarvis-set-"));
    const file = path.join(dir, "s.json");

    const def = await loadSettings(file); // missing file → defaults
    expect(def.codeGraphLevel).toBe("file");

    await fs.writeFile(
      file,
      JSON.stringify({ codeGraphLevel: "symbol" }),
      "utf8",
    );
    expect((await loadSettings(file)).codeGraphLevel).toBe("symbol");

    await fs.writeFile(
      file,
      JSON.stringify({ codeGraphLevel: "bogus" }),
      "utf8",
    );
    expect((await loadSettings(file)).codeGraphLevel).toBe("file"); // bad value ignored
  });
});
