import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import { posix, win32 } from "node:path";

export interface LocateDeps {
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  home: string;
  exists: (path: string) => Promise<boolean>;
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await fs.stat(path)).isFile();
  } catch {
    return false;
  }
}

export async function locateAntigravity(
  deps: Partial<LocateDeps> = {},
): Promise<string | null> {
  const platform = deps.platform ?? process.platform;
  const env = deps.env ?? process.env;
  const home = deps.home ?? homedir();
  const exists = deps.exists ?? isFile;

  const onWindows = platform === "win32";
  const flavor = onWindows ? win32 : posix;
  // Only a real program is spawned without a shell, so Windows takes agy.exe alone.
  const name = onWindows ? "agy.exe" : "agy";

  const candidates = [flavor.join(home, ".gemini", "bin", name)];
  if (onWindows && env.LOCALAPPDATA) {
    candidates.push(win32.join(env.LOCALAPPDATA, "agy", "bin", name));
  }
  const pathFolders = (env.PATH ?? env.Path ?? "")
    .split(flavor.delimiter)
    .filter(Boolean);
  for (const folder of pathFolders) candidates.push(flavor.join(folder, name));

  for (const candidate of candidates) {
    if (await exists(candidate)) return candidate;
  }
  return null;
}
