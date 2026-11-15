import { promises as fs } from "node:fs";
import { posix, win32 } from "node:path";

const MAC_APP_PROGRAM = "/Applications/Codex.app/Contents/Resources/codex";

async function modifiedTimeOfFile(path: string): Promise<number | null> {
  try {
    const stats = await fs.stat(path);
    return stats.isFile() ? stats.mtimeMs : null;
  } catch {
    return null;
  }
}

async function findOnPath(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
): Promise<string | null> {
  const flavor = platform === "win32" ? win32 : posix;
  const names =
    platform === "win32" ? ["codex.exe", "codex.cmd", "codex"] : ["codex"];
  const folders = (env.PATH ?? env.Path ?? "")
    .split(flavor.delimiter)
    .filter(Boolean);
  for (const folder of folders) {
    for (const name of names) {
      const candidate = flavor.join(folder, name);
      if ((await modifiedTimeOfFile(candidate)) !== null) return candidate;
    }
  }
  return null;
}

// The desktop app keeps its program in a hash-named folder that changes on update.
async function findNewestInAppFolder(
  localAppData: string,
): Promise<string | null> {
  const binFolder = win32.join(localAppData, "OpenAI", "Codex", "bin");
  let hashFolders: string[];
  try {
    hashFolders = await fs.readdir(binFolder);
  } catch {
    return null;
  }
  let newest: { path: string; mtimeMs: number } | null = null;
  for (const hashFolder of hashFolders) {
    const candidate = win32.join(binFolder, hashFolder, "codex.exe");
    const mtimeMs = await modifiedTimeOfFile(candidate);
    if (mtimeMs !== null && (newest === null || mtimeMs > newest.mtimeMs)) {
      newest = { path: candidate, mtimeMs };
    }
  }
  return newest?.path ?? null;
}

export async function locateCodex(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): Promise<string | null> {
  const onPath = await findOnPath(env, platform);
  if (onPath) return onPath;

  if (platform === "win32" && env.LOCALAPPDATA) {
    const inApp = await findNewestInAppFolder(env.LOCALAPPDATA);
    if (inApp) return inApp;
  }

  if (
    platform === "darwin" &&
    (await modifiedTimeOfFile(MAC_APP_PROGRAM)) !== null
  ) {
    return MAC_APP_PROGRAM;
  }
  return null;
}
