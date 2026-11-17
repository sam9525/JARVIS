import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  antigravityArgs,
  antigravityHooksJson,
  ensureAntigravityHooks,
} from "../../../src/main/agents/antigravity-hooks";

const FORWARD = "C:\\app\\hook\\forward.mjs";
const CONVERSATION = "0193a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b";
const SETTINGS = '{"notifications":true}';

describe("antigravityHooksJson", () => {
  it("registers forward.mjs under one jarvis group", () => {
    const j = JSON.parse(antigravityHooksJson(FORWARD));
    expect(Object.keys(j)).toEqual(["jarvis"]);
    const h = {
      type: "command",
      command: 'node "C:/app/hook/forward.mjs"',
      timeout: 5,
    };
    expect(j.jarvis.SessionStart).toEqual([h]);
    expect(j.jarvis.PreInvocation).toEqual([h]);
    expect(j.jarvis.Stop).toEqual([h]);
    expect(j.jarvis.PreToolUse).toEqual([{ matcher: "*", hooks: [h] }]);
    expect(j.jarvis.PostToolUse).toEqual([{ matcher: "*", hooks: [h] }]);
    expect(j.jarvis.PostInvocation).toBeUndefined();
  });
});

describe("antigravityArgs", () => {
  it("adds the hooks folder and turns notifications on", () => {
    expect(
      antigravityArgs({ dangerous: false, resume: false, hooksRoot: "R" }),
    ).toEqual(["--add-dir", "R", "--settings", SETTINGS]);
  });

  it("puts the permission bypass first and the conversation last", () => {
    expect(
      antigravityArgs({
        dangerous: true,
        resume: CONVERSATION,
        hooksRoot: "R",
      }),
    ).toEqual([
      "--dangerously-skip-permissions",
      "--add-dir",
      "R",
      "--settings",
      SETTINGS,
      "--conversation",
      CONVERSATION,
    ]);
  });

  it("drops a resume value that is not a session id", () => {
    expect(
      antigravityArgs({ dangerous: false, resume: "x & calc", hooksRoot: "R" }),
    ).not.toContain("--conversation");
  });

  it("drops a resume without an id", () => {
    expect(
      antigravityArgs({ dangerous: false, resume: true, hooksRoot: "R" }),
    ).not.toContain("--conversation");
  });
});

describe("ensureAntigravityHooks", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "jarvis-agy-hooks-"));
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("writes .agents/hooks.json under the root", async () => {
    const root = path.join(dir, "hooks");
    expect(await ensureAntigravityHooks(root, FORWARD)).toBe(true);
    expect(
      await fs.readFile(path.join(root, ".agents", "hooks.json"), "utf8"),
    ).toBe(antigravityHooksJson(FORWARD));
  });

  it("leaves a file with the same content untouched", async () => {
    const file = path.join(dir, ".agents", "hooks.json");
    await ensureAntigravityHooks(dir, FORWARD);
    const past = new Date("2020-01-01T00:00:00Z");
    await fs.utimes(file, past, past);
    expect(await ensureAntigravityHooks(dir, FORWARD)).toBe(true);
    expect((await fs.stat(file)).mtimeMs).toBe(past.getTime());
  });

  it("rewrites a file whose content differs", async () => {
    const file = path.join(dir, ".agents", "hooks.json");
    await ensureAntigravityHooks(dir, "C:\\old\\forward.mjs");
    expect(await ensureAntigravityHooks(dir, FORWARD)).toBe(true);
    expect(await fs.readFile(file, "utf8")).toBe(antigravityHooksJson(FORWARD));
  });

  it("returns false when the root cannot be created", async () => {
    const blocker = path.join(dir, "blocker");
    await fs.writeFile(blocker, "");
    expect(
      await ensureAntigravityHooks(path.join(blocker, "hooks"), FORWARD),
    ).toBe(false);
  });
});
