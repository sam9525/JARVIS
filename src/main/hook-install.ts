import { promises as fs } from "node:fs";
import path from "node:path";
import { mergeHooks, stripHooks } from "../hook/merge.mjs";

// v1 installed hooks into .claude/settings.json — Claude Code's shared,
// version-controlled file. Code workspaces come from the gitnexus registry and
// commonly track it, so we write the auto-gitignored settings.local.json
// instead and clean our entry out of the shared file if v1 left one there.
async function removeLegacyHooks(sharedPath: string): Promise<void> {
  const raw = await fs.readFile(sharedPath, "utf8").catch(() => null);
  if (raw === null) return;
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return; // someone else's broken file — not ours to fix
  }
  const stripped = stripHooks(parsed);
  if (!stripped) return; // nothing of ours: leave it byte-identical
  await fs
    .writeFile(sharedPath, JSON.stringify(stripped, null, 2) + "\n")
    .catch(() => undefined);
}

// Auto-install before first terminal launch. Returns false when the target
// settings.local.json is unparseable or the write fails (read-only .claude,
// EPERM, .claude existing as a file) — caller still launches the terminal (a
// broken settings file must never block Claude Code) and surfaces a notice.
export async function ensureHooks(
  workspaceRoot: string,
  forwardPath: string,
): Promise<boolean> {
  const claudeDir = path.join(workspaceRoot, ".claude");
  const settingsPath = path.join(claudeDir, "settings.local.json");
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
    await fs.mkdir(claudeDir, { recursive: true });
    await fs.writeFile(settingsPath, JSON.stringify(merged, null, 2) + "\n");
  } catch {
    return false;
  }
  await removeLegacyHooks(path.join(claudeDir, "settings.json"));
  return true;
}
