import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  toStatusLineView,
  userStatusLine,
  withStatusLine,
} from "../../src/main/status-line";

const git = { branch: "feature/session-screen", commit: "keep the feed alive" };

describe("toStatusLineView", () => {
  it("maps a full status JSON", () => {
    const view = toStatusLineView(
      {
        model: { display_name: "Opus 5.5" },
        effort: { level: "high" },
        workspace: { current_dir: "D:\\data\\Program\\JARVIS" },
        context_window: { used_percentage: 38.7 },
        rate_limits: {
          five_hour: { used_percentage: 63.2, resets_at: 1790000000 },
          seven_day: { used_percentage: 44.9, resets_at: 1790500000 },
        },
      },
      git,
    );
    expect(view).toEqual({
      model: "Opus 5.5",
      effort: "high",
      folder: "JARVIS",
      branch: git.branch,
      commit: git.commit,
      contextPct: 38,
      fiveHourPct: 63,
      fiveHourResetsAt: 1790000000,
      sevenDayPct: 44,
      sevenDayResetsAt: 1790500000,
    });
  });

  it("takes the folder from a posix path too", () => {
    const view = toStatusLineView(
      { workspace: { current_dir: "/home/me/proj/" } },
      git,
    );
    expect(view.folder).toBe("proj");
  });

  it("maps missing fields to empty and null", () => {
    const view = toStatusLineView({}, { branch: "", commit: "" });
    expect(view).toEqual({
      model: "",
      effort: "",
      folder: "",
      branch: "",
      commit: "",
      contextPct: null,
      fiveHourPct: null,
      fiveHourResetsAt: null,
      sevenDayPct: null,
      sevenDayResetsAt: null,
    });
  });
});

describe("withStatusLine", () => {
  it("replaces our own entry", () => {
    const out = withStatusLine(
      { statusLine: { type: "command", command: 'node "old/statusline.mjs"' } },
      'node "new/statusline.mjs"',
    );
    expect(out).toEqual({
      statusLine: { type: "command", command: 'node "new/statusline.mjs"' },
    });
  });

  it("leaves a foreign status line alone", () => {
    expect(
      withStatusLine(
        { statusLine: { type: "command", command: "bash mine.sh" } },
        'node "x/statusline.mjs"',
      ),
    ).toBeNull();
  });
});

describe("userStatusLine", () => {
  let dirs: string[] = [];
  afterEach(() => {
    dirs.forEach((d) => rmSync(d, { recursive: true, force: true }));
    dirs = [];
  });
  const withSettings = (command?: string): string => {
    const d = mkdtempSync(path.join(os.tmpdir(), "jarvis-sl-"));
    dirs.push(d);
    if (command) {
      mkdirSync(path.join(d, ".claude"));
      writeFileSync(
        path.join(d, ".claude", "settings.json"),
        JSON.stringify({ statusLine: { type: "command", command } }),
      );
    }
    return d;
  };

  it("prefers the project file", async () => {
    expect(
      await userStatusLine(withSettings("home"), withSettings("proj")),
    ).toBe("proj");
  });

  it("falls back to the home file, then null", async () => {
    expect(await userStatusLine(withSettings("home"), withSettings())).toBe(
      "home",
    );
    expect(await userStatusLine(withSettings(), withSettings())).toBeNull();
  });
});
