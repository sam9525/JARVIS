import { promises as fs } from "node:fs";
import path from "node:path";

// Folder paths compare equal with either slash, either case and one trailing slash.
const comparable = (p: string) =>
  p.replace(/\\/g, "/").replace(/\/$/, "").toLowerCase();

/** Whether agy's own trust list holds exactly this folder, so agy asks no trust question. */
export async function isAntigravityTrusted(
  home: string,
  cwd: string,
): Promise<boolean> {
  let settings: unknown;
  try {
    settings = JSON.parse(
      await fs.readFile(
        path.join(home, ".gemini", "antigravity-cli", "settings.json"),
        "utf8",
      ),
    );
  } catch {
    return false;
  }
  if (typeof settings !== "object" || settings === null) return false;
  const list = (settings as Record<string, unknown>).trustedWorkspaces;
  if (!Array.isArray(list)) return false;
  const wanted = comparable(cwd);
  return list.some(
    (entry) => typeof entry === "string" && comparable(entry) === wanted,
  );
}
