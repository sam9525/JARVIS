import { promises as fs } from "node:fs";
import path from "node:path";
import { mergeHooks } from "../hook/merge.mjs";

// Auto-install before first terminal launch. Returns false when the target
// settings.json is unparseable or the write fails (read-only .claude, EPERM,
// .claude existing as a file) — caller still launches the terminal (a broken
// settings file must never block Claude Code) and surfaces a notice.
export async function ensureHooks(
  workspaceRoot: string,
  forwardPath: string,
): Promise<boolean> {
  const settingsPath = path.join(workspaceRoot, ".claude", "settings.json");
  let settings: Record<string, unknown> = {};
  const raw = await fs.readFile(settingsPath, "utf8").catch(() => null);
  if (raw !== null) {
    try {
      settings = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return false;
    }
  }
  const merged = mergeHooks(settings, `node "${forwardPath}"`);
  try {
    await fs.mkdir(path.dirname(settingsPath), { recursive: true });
    await fs.writeFile(settingsPath, JSON.stringify(merged, null, 2) + "\n");
  } catch {
    return false;
  }
  return true;
}
