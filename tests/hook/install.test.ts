import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HOOK_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "src",
  "hook",
);
const INSTALL = path.join(HOOK_DIR, "install.mjs");
const COMMAND = `node "${path.join(HOOK_DIR, "forward.mjs")}"`;

function runInstall(vault: string) {
  return spawnSync(process.execPath, [INSTALL, vault], { encoding: "utf8" });
}

function localSettingsPath(vault: string) {
  return path.join(vault, ".claude", "settings.local.json");
}

function sharedSettingsPath(vault: string) {
  return path.join(vault, ".claude", "settings.json");
}

function readSettings(vault: string) {
  return JSON.parse(readFileSync(localSettingsPath(vault), "utf8"));
}

describe("install.mjs", () => {
  let vault: string;

  beforeEach(() => {
    vault = mkdtempSync(path.join(tmpdir(), "jarvis-install-"));
  });

  afterEach(() => {
    rmSync(vault, { recursive: true, force: true });
  });

  it("installs hooks into a fresh vault", () => {
    const result = runInstall(vault);

    expect(result.status).toBe(0);
    const settings = readSettings(vault);
    expect(settings.hooks.PreToolUse).toEqual([
      {
        matcher: "*",
        hooks: [{ type: "command", command: COMMAND }],
      },
    ]);
    expect(settings.hooks.PostToolUse).toEqual([
      {
        matcher:
          "Read|Grep|Glob|Edit|Write|AskUserQuestion|mcp__gitnexus__impact",
        hooks: [{ type: "command", command: COMMAND }],
      },
    ]);
  });

  it("installs a matcher-less UserPromptSubmit hook (prompt hooks take no matcher)", () => {
    runInstall(vault);

    const settings = readSettings(vault);
    expect(settings.hooks.UserPromptSubmit).toEqual([
      { hooks: [{ type: "command", command: COMMAND }] },
    ]);
  });

  it("is idempotent on re-run (no duplicates)", () => {
    runInstall(vault);
    runInstall(vault);

    const settings = readSettings(vault);
    expect(settings.hooks.PreToolUse).toHaveLength(1);
    expect(settings.hooks.PostToolUse).toHaveLength(1);
    expect(settings.hooks.UserPromptSubmit).toHaveLength(1);
  });

  it("preserves existing user settings and unrelated hooks", () => {
    const claudeDir = path.join(vault, ".claude");
    mkdirSync(claudeDir, { recursive: true });
    const userHook = {
      matcher: "Bash",
      hooks: [{ type: "command", command: "echo hi" }],
    };
    // this seed contains none of our hooks, so it's a foreign tracked file —
    // stripHooks must return null and leave it byte-identical
    const original = JSON.stringify({
      permissions: { allow: ["Read"] },
      hooks: { PreToolUse: [userHook] },
    });
    writeFileSync(sharedSettingsPath(vault), original);

    runInstall(vault);

    expect(readFileSync(sharedSettingsPath(vault), "utf8")).toBe(original);
    const settings = readSettings(vault);
    expect(settings.hooks.PreToolUse).toEqual([
      {
        matcher: "*",
        hooks: [{ type: "command", command: COMMAND }],
      },
    ]);
    expect(settings.hooks.PostToolUse).toEqual([
      {
        matcher:
          "Read|Grep|Glob|Edit|Write|AskUserQuestion|mcp__gitnexus__impact",
        hooks: [{ type: "command", command: COMMAND }],
      },
    ]);
    expect(settings.hooks.UserPromptSubmit).toEqual([
      { hooks: [{ type: "command", command: COMMAND }] },
    ]);
  });

  it("migrates v1 hooks out of the shared settings.json", () => {
    const claudeDir = path.join(vault, ".claude");
    mkdirSync(claudeDir, { recursive: true });
    writeFileSync(
      sharedSettingsPath(vault),
      JSON.stringify({
        hooks: {
          PreToolUse: [
            {
              matcher: "Read",
              hooks: [
                {
                  type: "command",
                  command: 'node "C:/old/checkout/src/hook/forward.mjs"',
                },
              ],
            },
          ],
        },
      }),
    );

    runInstall(vault);

    const shared = JSON.parse(readFileSync(sharedSettingsPath(vault), "utf8"));
    expect(JSON.stringify(shared)).not.toContain("forward.mjs");
    const settings = readSettings(vault);
    expect(settings.hooks.PreToolUse).toEqual([
      {
        matcher: "*",
        hooks: [{ type: "command", command: COMMAND }],
      },
    ]);
  });

  it("exits 1 on malformed settings.json without touching the file", () => {
    const claudeDir = path.join(vault, ".claude");
    mkdirSync(claudeDir, { recursive: true });
    const settingsPath = localSettingsPath(vault);
    writeFileSync(settingsPath, "{ not json");

    const result = runInstall(vault);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("could not parse");
    expect(readFileSync(settingsPath, "utf8")).toBe("{ not json");
  });

  it("exits 1 when the vault directory does not exist", () => {
    const result = runInstall(path.join(vault, "no-such-dir"));

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("vault directory not found");
  });

  it("does not fail install when the shared settings.json is malformed", () => {
    const claudeDir = path.join(vault, ".claude");
    mkdirSync(claudeDir, { recursive: true });
    const sharedPath = sharedSettingsPath(vault);
    writeFileSync(sharedPath, "{ not json");

    const result = runInstall(vault);

    expect(result.status).toBe(0);
    const settings = readSettings(vault);
    expect(JSON.stringify(settings.hooks)).toContain("forward.mjs");
    expect(readFileSync(sharedPath, "utf8")).toBe("{ not json");
  });
});
