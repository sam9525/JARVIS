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

const tmp = () => mkdtempSync(path.join(os.tmpdir(), "jarvis-hooks-"));
const localPath = (d: string) => path.join(d, ".claude", "settings.local.json");
const sharedPath = (d: string) => path.join(d, ".claude", "settings.json");

describe("ensureHooks", () => {
  it("creates .claude/settings.local.json with the three hook events", async () => {
    dir = tmp();
    const ok = await ensureHooks(dir, "C:\\app\\src\\hook\\forward.mjs");
    expect(ok).toBe(true);
    const s = JSON.parse(readFileSync(localPath(dir), "utf8"));
    for (const ev of ["PreToolUse", "PostToolUse", "UserPromptSubmit"]) {
      expect(JSON.stringify(s.hooks[ev]).includes("forward.mjs"), ev).toBe(
        true,
      );
    }
  });

  it("preserves foreign hooks and is idempotent", async () => {
    dir = tmp();
    mkdirSync(path.dirname(localPath(dir)), { recursive: true });
    writeFileSync(
      localPath(dir),
      JSON.stringify({
        hooks: {
          PreToolUse: [{ hooks: [{ type: "command", command: "other" }] }],
        },
      }),
    );
    await ensureHooks(dir, "C:\\app\\forward.mjs");
    await ensureHooks(dir, "C:\\app\\forward.mjs"); // run twice
    const s = JSON.parse(readFileSync(localPath(dir), "utf8"));
    const pre = JSON.stringify(s.hooks.PreToolUse);
    expect(pre.includes("other")).toBe(true);
    expect(pre.match(/forward\.mjs/g)).toHaveLength(1); // not duplicated
  });

  it("leaves a repo's shared settings.json byte-identical", async () => {
    dir = tmp();
    mkdirSync(path.dirname(sharedPath(dir)), { recursive: true });
    // deliberately non-canonical formatting: proves we never rewrite it
    const original = '{"hooks":{"PreToolUse":[{"hooks":[]}]},"model":"opus"}';
    writeFileSync(sharedPath(dir), original);
    expect(await ensureHooks(dir, "C:\\app\\forward.mjs")).toBe(true);
    expect(readFileSync(sharedPath(dir), "utf8")).toBe(original);
  });

  it("strips v1's hooks out of the shared settings.json, keeping foreign ones", async () => {
    dir = tmp();
    mkdirSync(path.dirname(sharedPath(dir)), { recursive: true });
    writeFileSync(
      sharedPath(dir),
      JSON.stringify({
        hooks: {
          PreToolUse: [
            { hooks: [{ type: "command", command: "node old/forward.mjs" }] },
            { hooks: [{ type: "command", command: "keep-me" }] },
          ],
          UserPromptSubmit: [
            { hooks: [{ type: "command", command: "node old/forward.mjs" }] },
          ],
        },
      }),
    );
    await ensureHooks(dir, "C:\\app\\forward.mjs");
    const shared = JSON.parse(readFileSync(sharedPath(dir), "utf8"));
    expect(JSON.stringify(shared).includes("forward.mjs")).toBe(false);
    expect(JSON.stringify(shared.hooks.PreToolUse).includes("keep-me")).toBe(
      true,
    );
    // the emptied event is dropped rather than left as []
    expect(shared.hooks.UserPromptSubmit).toBeUndefined();
    // and the hooks still landed in the local file
    expect(readFileSync(localPath(dir), "utf8")).toContain("forward.mjs");
  });

  it("returns false and writes nothing when settings.local.json is unparseable", async () => {
    dir = tmp();
    mkdirSync(path.dirname(localPath(dir)), { recursive: true });
    writeFileSync(localPath(dir), "{broken");
    expect(await ensureHooks(dir, "C:\\app\\forward.mjs")).toBe(false);
    expect(readFileSync(localPath(dir), "utf8")).toBe("{broken");
  });

  it("resolves false instead of rejecting when .claude exists as a file", async () => {
    dir = tmp();
    writeFileSync(path.join(dir, ".claude"), "i am a file");
    await expect(ensureHooks(dir, "C:\\app\\forward.mjs")).resolves.toBe(false);
  });
});
