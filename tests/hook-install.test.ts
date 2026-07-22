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
import { mergeHooks } from "../src/hook/merge.mjs";

let dir: string;
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const tmp = () => mkdtempSync(path.join(os.tmpdir(), "jarvis-hooks-"));
const localPath = (d: string) => path.join(d, ".claude", "settings.local.json");
const sharedPath = (d: string) => path.join(d, ".claude", "settings.json");

describe("ensureHooks", () => {
  it("creates .claude/settings.local.json with the five hook events", async () => {
    dir = tmp();
    const ok = await ensureHooks(dir, "C:\\app\\src\\hook\\forward.mjs");
    expect(ok).toBe(true);
    const s = JSON.parse(readFileSync(localPath(dir), "utf8"));
    for (const ev of [
      "PreToolUse",
      "PostToolUse",
      "UserPromptSubmit",
      "Notification",
      "Stop",
    ]) {
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

describe("mergeHooks", () => {
  it("registers Notification and Stop alongside the existing three", () => {
    const out = mergeHooks({}, "node forward.mjs");
    expect(Object.keys(out.hooks).sort()).toEqual([
      "Notification",
      "PostToolUse",
      "PreToolUse",
      "Stop",
      "UserPromptSubmit",
    ]);
  });

  it("PreToolUse matches every tool; PostToolUse stays narrow", () => {
    const out = mergeHooks({}, "node forward.mjs");
    expect(out.hooks.PreToolUse[0].matcher).toBe("*");
    // a widened PostToolUse would ship every Bash command's full output
    expect(out.hooks.PostToolUse[0].matcher).toBe("Read|Grep|Glob|Edit|Write");
  });

  it("Stop and Notification are registered matcher-less", () => {
    const out = mergeHooks({}, "node forward.mjs");
    expect(out.hooks.Stop[0].matcher).toBeUndefined();
    expect(out.hooks.Notification[0].matcher).toBeUndefined();
  });

  // the upgrade path: an existing install carries the OLD narrow PreToolUse
  // matcher. Re-installing must replace it, not sit alongside it — a duplicate
  // would forward every event twice.
  it("upgrades an old narrow-matcher install in place", () => {
    const old = mergeHooks({}, "node forward.mjs");
    old.hooks.PreToolUse[0].matcher = "Read|Grep|Glob|Edit|Write"; // simulate v2
    delete old.hooks.Notification;
    delete old.hooks.Stop;

    const out = mergeHooks(old, "node forward.mjs");
    expect(out.hooks.PreToolUse).toHaveLength(1);
    expect(out.hooks.PreToolUse[0].matcher).toBe("*");
    expect(out.hooks.Stop).toHaveLength(1);
  });

  it("leaves a foreign hook on a new event untouched", () => {
    const foreign = {
      hooks: {
        Stop: [{ hooks: [{ type: "command", command: "echo other" }] }],
      },
    };
    const out = mergeHooks(foreign, "node forward.mjs");
    expect(out.hooks.Stop).toHaveLength(2); // theirs + ours
  });
});
