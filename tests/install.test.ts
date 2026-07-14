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
  "src",
  "hook",
);
const INSTALL = path.join(HOOK_DIR, "install.mjs");
const COMMAND = `node "${path.join(HOOK_DIR, "forward.mjs")}"`;

function runInstall(vault: string) {
  return spawnSync(process.execPath, [INSTALL, vault], { encoding: "utf8" });
}

function readSettings(vault: string) {
  return JSON.parse(
    readFileSync(path.join(vault, ".claude", "settings.json"), "utf8"),
  );
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
    for (const event of ["PreToolUse", "PostToolUse"]) {
      expect(settings.hooks[event]).toEqual([
        {
          matcher: "Read|Grep|Glob|Edit|Write",
          hooks: [{ type: "command", command: COMMAND }],
        },
      ]);
    }
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
    writeFileSync(
      path.join(claudeDir, "settings.json"),
      JSON.stringify({
        permissions: { allow: ["Read"] },
        hooks: { PreToolUse: [userHook] },
      }),
    );

    runInstall(vault);

    const settings = readSettings(vault);
    expect(settings.permissions).toEqual({ allow: ["Read"] });
    expect(settings.hooks.PreToolUse).toEqual([
      userHook,
      expect.objectContaining({ matcher: "Read|Grep|Glob|Edit|Write" }),
    ]);
  });

  it("replaces stale forward.mjs entries instead of skipping", () => {
    const claudeDir = path.join(vault, ".claude");
    mkdirSync(claudeDir, { recursive: true });
    writeFileSync(
      path.join(claudeDir, "settings.json"),
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

    const settings = readSettings(vault);
    expect(settings.hooks.PreToolUse).toEqual([
      {
        matcher: "Read|Grep|Glob|Edit|Write",
        hooks: [{ type: "command", command: COMMAND }],
      },
    ]);
  });

  it("exits 1 on malformed settings.json without touching the file", () => {
    const claudeDir = path.join(vault, ".claude");
    mkdirSync(claudeDir, { recursive: true });
    const settingsPath = path.join(claudeDir, "settings.json");
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
});
