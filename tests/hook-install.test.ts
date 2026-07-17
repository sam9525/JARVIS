import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  mkdirSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ensureHooks } from "../src/main/hook-install";

let dir: string;
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("ensureHooks", () => {
  it("creates .claude/settings.json with the three hook events", async () => {
    dir = mkdtempSync(path.join(os.tmpdir(), "jarvis-hooks-"));
    const ok = await ensureHooks(dir, "C:\\app\\src\\hook\\forward.mjs");
    expect(ok).toBe(true);
    const s = JSON.parse(
      readFileSync(path.join(dir, ".claude", "settings.json"), "utf8"),
    );
    for (const ev of ["PreToolUse", "PostToolUse", "UserPromptSubmit"]) {
      expect(JSON.stringify(s.hooks[ev]).includes("forward.mjs"), ev).toBe(
        true,
      );
    }
  });

  it("preserves foreign hooks and is idempotent", async () => {
    dir = mkdtempSync(path.join(os.tmpdir(), "jarvis-hooks-"));
    const settingsPath = path.join(dir, ".claude", "settings.json");
    mkdirSync(path.dirname(settingsPath), { recursive: true });
    writeFileSync(
      settingsPath,
      JSON.stringify({
        hooks: {
          PreToolUse: [{ hooks: [{ type: "command", command: "other" }] }],
        },
      }),
    );
    await ensureHooks(dir, "C:\\app\\forward.mjs");
    await ensureHooks(dir, "C:\\app\\forward.mjs"); // run twice
    const s = JSON.parse(readFileSync(settingsPath, "utf8"));
    const pre = JSON.stringify(s.hooks.PreToolUse);
    expect(pre.includes("other")).toBe(true);
    expect(pre.match(/forward\.mjs/g)).toHaveLength(1); // not duplicated
  });

  it("returns false and writes nothing when settings.json is unparseable", async () => {
    dir = mkdtempSync(path.join(os.tmpdir(), "jarvis-hooks-"));
    const settingsPath = path.join(dir, ".claude", "settings.json");
    mkdirSync(path.dirname(settingsPath), { recursive: true });
    writeFileSync(settingsPath, "{broken");
    expect(await ensureHooks(dir, "C:\\app\\forward.mjs")).toBe(false);
    expect(readFileSync(settingsPath, "utf8")).toBe("{broken");
  });

  it("resolves false instead of rejecting when .claude exists as a file", async () => {
    dir = mkdtempSync(path.join(os.tmpdir(), "jarvis-hooks-"));
    writeFileSync(path.join(dir, ".claude"), "i am a file");
    await expect(ensureHooks(dir, "C:\\app\\forward.mjs")).resolves.toBe(false);
  });
});
