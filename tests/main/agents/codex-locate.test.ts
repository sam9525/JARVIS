import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { locateCodex } from "../../../src/main/agents/codex-locate";

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(join(tmpdir(), "codex-locate-"));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

async function writeExe(path: string, mtimeSeconds: number): Promise<void> {
  await fs.mkdir(join(path, ".."), { recursive: true });
  await fs.writeFile(path, "");
  await fs.utimes(path, mtimeSeconds, mtimeSeconds);
}

function appExe(hash: string): string {
  return join(root, "OpenAI", "Codex", "bin", hash, "codex.exe");
}

describe("locateCodex", () => {
  it.skipIf(process.platform !== "win32")(
    "picks the codex.exe with the newest mtime among the app folders",
    async () => {
      await writeExe(appExe("aaa"), 2_000);
      await writeExe(appExe("bbb"), 1_000);
      const env = { LOCALAPPDATA: root, PATH: "" };
      expect(await locateCodex(env, "win32")).toBe(appExe("aaa"));
      await fs.utimes(appExe("bbb"), 3_000, 3_000);
      expect(await locateCodex(env, "win32")).toBe(appExe("bbb"));
    },
  );

  it("returns null when nothing is installed", async () => {
    const env = { LOCALAPPDATA: root, PATH: "" };
    expect(await locateCodex(env, "win32")).toBeNull();
  });

  it.skipIf(process.platform !== "win32")(
    "prefers a codex.exe on PATH over the app folder",
    async () => {
      await writeExe(appExe("aaa"), 2_000);
      const pathDir = join(root, "tools");
      const onPath = join(pathDir, "codex.exe");
      await writeExe(onPath, 1_000);
      const env = { LOCALAPPDATA: root, PATH: pathDir };
      expect(await locateCodex(env, "win32")).toBe(onPath);
    },
  );

  // A Windows temp folder holds ":" so it cannot sit in a posix PATH.
  it.skipIf(process.platform === "win32")(
    "finds codex on a posix PATH",
    async () => {
      const onPath = join(root, "codex");
      await writeExe(onPath, 1_000);
      expect(await locateCodex({ PATH: root }, "linux")).toBe(onPath);
    },
  );

  it("returns null on darwin with an empty PATH and no app file", async () => {
    expect(await locateCodex({ PATH: "" }, "darwin")).toBeNull();
  });

  it.skipIf(process.platform !== "win32")(
    "skips a codex.cmd or an extensionless codex on PATH",
    async () => {
      const cmdDir = join(root, "npm");
      const shimDir = join(root, "shim");
      await writeExe(join(cmdDir, "codex.cmd"), 1_000);
      await writeExe(join(shimDir, "codex"), 1_000);
      const env = { LOCALAPPDATA: root, PATH: `${cmdDir};${shimDir}` };
      expect(await locateCodex(env, "win32")).toBeNull();
    },
  );

  it.skipIf(process.platform !== "win32")(
    "passes a codex.cmd for a codex.exe in a later PATH folder",
    async () => {
      const cmdDir = join(root, "npm");
      const exeDir = join(root, "tools");
      await writeExe(join(cmdDir, "codex.cmd"), 1_000);
      await writeExe(join(exeDir, "codex.exe"), 1_000);
      const env = { LOCALAPPDATA: root, PATH: `${cmdDir};${exeDir}` };
      expect(await locateCodex(env, "win32")).toBe(join(exeDir, "codex.exe"));
    },
  );
});
