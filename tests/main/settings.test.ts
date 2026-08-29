import { describe, it, expect } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { loadSettings, saveSettings } from "../../src/main/settings";
import { defaultSettings } from "../../src/shared/types";
import type { Settings } from "../../src/shared/types";

async function tmpFile(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "jarvis-settings-"));
  return path.join(dir, "jarvis-settings.json");
}

async function writeSettings(obj: unknown): Promise<string> {
  const f = await tmpFile();
  await fs.writeFile(f, JSON.stringify(obj), "utf8");
  return f;
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

  // both stay absent when the file has none: the renderer reads "no entry" as
  // "never drawn" and draws one, where a {} or an [] would read as a real value
  it("round-trips the drawn palette, dropping entries it cannot use", async () => {
    const file = await writeSettings({
      mainColors: { "d:/a": "#112233", "d:/b": "nonsense", "d:/c": 7 },
      recentHues: [12, "purple", 200, null],
    });
    const loaded = await loadSettings(file);
    expect(loaded.mainColors).toEqual({ "d:/a": "#112233" });
    expect(loaded.recentHues).toEqual([12, 200]);
  });

  it("keeps only the last ten hues from an oversized pick log", async () => {
    const recentHues = Array.from({ length: 500 }, (_, i) => i % 360);
    const file = await writeSettings({ recentHues });
    const s = await loadSettings(file);
    expect(s.recentHues).toEqual(recentHues.slice(-10));
  });

  it("leaves the palette absent when the file has none", async () => {
    const file = await writeSettings({ showTags: false });
    const loaded = await loadSettings(file);
    expect(loaded.mainColors).toBeUndefined();
    expect(loaded.recentHues).toBeUndefined();
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

  it("defaults handControl off", () => {
    expect(defaultSettings().handControl).toBe(false);
  });

  it("a pre-v0.3.4 settings file loads without the key and stays off", async () => {
    const file = await tmpFile();
    await fs.writeFile(
      file,
      JSON.stringify({ sectionFilter: "raw" }), // no handControl key
      "utf8",
    );
    expect((await loadSettings(file)).handControl).toBe(false);
  });

  it("round-trips a persisted handControl: true", async () => {
    const file = await tmpFile();
    await fs.writeFile(file, JSON.stringify({ handControl: true }), "utf8");
    expect((await loadSettings(file)).handControl).toBe(true);
  });

  it("defaults voiceControl off", () => {
    expect(defaultSettings().voiceControl).toBe(false);
  });

  it("a pre-v0.4.0 settings file loads without the key and stays off", async () => {
    const file = await writeSettings({ sectionFilter: "raw" }); // no voiceControl
    expect((await loadSettings(file)).voiceControl).toBe(false);
  });

  it("round-trips a persisted voiceControl: true", async () => {
    const file = await writeSettings({ voiceControl: true });
    expect((await loadSettings(file)).voiceControl).toBe(true);
  });

  it("ignores a non-boolean voiceControl", async () => {
    const file = await writeSettings({ voiceControl: "yes" });
    expect((await loadSettings(file)).voiceControl).toBe(false);
  });

  it("defaults panels to two empty layouts", async () => {
    const f = await writeSettings({});
    const s = await loadSettings(f);
    expect(s.panels).toEqual({ home: {}, workspace: {} });
  });

  it("keeps a well-formed panel", async () => {
    const f = await writeSettings({
      panels: {
        workspace: {
          terminal: { x: 10, y: 20, w: 300, h: 400, collapsed: false, z: 2 },
        },
      },
    });
    const s = await loadSettings(f);
    expect(s.panels.workspace.terminal).toEqual({
      x: 10,
      y: 20,
      w: 300,
      h: 400,
      collapsed: false,
      z: 2,
    });
    expect(s.panels.home).toEqual({});
  });

  it("round-trips the window the panels were measured in", async () => {
    const f = await writeSettings({
      panelViewport: { width: 1536, height: 864 },
    });
    expect((await loadSettings(f)).panelViewport).toEqual({
      width: 1536,
      height: 864,
    });
  });

  it("leaves panelViewport absent when the file has none or a bad one", async () => {
    expect(
      (await loadSettings(await writeSettings({}))).panelViewport,
    ).toBeUndefined();
    const bad = await writeSettings({
      panelViewport: { width: 0, height: 864 },
    });
    expect((await loadSettings(bad)).panelViewport).toBeUndefined();
  });

  it("drops a panel with a non-finite coordinate", async () => {
    const f = await writeSettings({
      panels: {
        workspace: {
          terminal: { x: NaN, y: 20, w: 300, h: 400, collapsed: false, z: 1 },
        },
      },
    });
    expect((await loadSettings(f)).panels.workspace).toEqual({});
  });

  it("drops an unknown panel id", async () => {
    const f = await writeSettings({
      panels: {
        workspace: {
          bogus: { x: 1, y: 1, w: 300, h: 400, collapsed: false, z: 1 },
        },
      },
    });
    expect((await loadSettings(f)).panels.workspace).toEqual({});
  });

  it("ignores a panels value that is not an object", async () => {
    const f = await writeSettings({ panels: "nope" });
    expect((await loadSettings(f)).panels).toEqual({ home: {}, workspace: {} });
  });

  it("round-trips micDeviceId", async () => {
    const file = await writeSettings({ micDeviceId: "abc123" });
    expect((await loadSettings(file)).micDeviceId).toBe("abc123");
  });

  it("drops a non-string or empty micDeviceId", async () => {
    expect(
      (await loadSettings(await writeSettings({ micDeviceId: 7 }))).micDeviceId,
    ).toBeUndefined();
    expect(
      (await loadSettings(await writeSettings({ micDeviceId: "" })))
        .micDeviceId,
    ).toBeUndefined();
  });

  it("round-trips the tts fields", async () => {
    const file = await writeSettings({
      ttsVoiceId: "v1",
      ttsModelId: "m1",
    });
    const s = await loadSettings(file);
    expect(s.ttsVoiceId).toBe("v1");
    expect(s.ttsModelId).toBe("m1");
  });

  it("drops non-string tts fields", async () => {
    const s = await loadSettings(
      await writeSettings({ ttsVoiceId: {}, ttsModelId: [] }),
    );
    expect(s.ttsVoiceId).toBeUndefined();
    // no voice default exists, but the model has one — a malformed value
    // falls back to it rather than leaving the app with no model
    expect(s.ttsModelId).toBe("eleven_multilingual_v2");
  });

  it("round-trips the head model, and drops a non-string one", async () => {
    expect(
      (await loadSettings(await writeSettings({ headModel: "a.glb" })))
        .headModel,
    ).toBe("a.glb");
    // absent means the built-in helmet, which is also what a bad value gets
    expect(
      (await loadSettings(await writeSettings({ headModel: 7 }))).headModel,
    ).toBeUndefined();
  });

  it("round-trips the head colour, mouth and picked regions", async () => {
    const file = await writeSettings({
      headColor: true,
      headMouth: true,
      headMouths: { "avatar.glb": { c: [0, 0.4, 0.9], r: 0.18 } },
    });
    const s = await loadSettings(file);
    expect(s.headColor).toBe(true);
    expect(s.headMouth).toBe(true);
    expect(s.headMouths?.["avatar.glb"]).toEqual({ c: [0, 0.4, 0.9], r: 0.18 });
  });

  it("drops a malformed picked region rather than loading it", async () => {
    const file = await writeSettings({
      headColor: "yes",
      headMouths: {
        ok: { c: [0, 0, 0], r: 0.2 },
        shortVector: { c: [0, 0], r: 0.2 },
        noRadius: { c: [0, 0, 0] },
        stringRadius: { c: [0, 0, 0], r: "wide" },
      },
    });
    const s = await loadSettings(file);
    expect(s.headColor).toBeUndefined();
    expect(Object.keys(s.headMouths ?? {})).toEqual(["ok"]);
  });
});
