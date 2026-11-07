import { promises as fs } from "node:fs";
import path from "node:path";

export interface SlashCommand {
  name: string;
  description: string;
}

type Frontmatter = Record<string, string>;

async function readText(file: string): Promise<string | null> {
  try {
    return await fs.readFile(file, "utf8");
  } catch {
    return null;
  }
}

async function readJson(file: string): Promise<unknown> {
  const text = await readText(file);
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function readDir(dir: string): Promise<string[]> {
  try {
    return await fs.readdir(dir);
  } catch {
    return [];
  }
}

/** Single-line `key: value` pairs between the leading `---` fences. */
function parseFrontmatter(text: string): Frontmatter {
  const lines = text.split(/\r?\n/);
  const fields: Frontmatter = {};
  if (lines[0]?.trim() !== "---") return fields;
  for (const line of lines.slice(1)) {
    if (line.trim() === "---") break;
    const match = /^([\w-]+):\s*(.*)$/.exec(line);
    if (!match) continue;
    fields[match[1]] = match[2].trim().replace(/^(["'])(.*)\1$/, "$2");
  }
  return fields;
}

async function readSkills(
  dir: string,
  prefix: string,
): Promise<SlashCommand[]> {
  const rows: SlashCommand[] = [];
  for (const folder of await readDir(dir)) {
    const text = await readText(path.join(dir, folder, "SKILL.md"));
    if (text === null) continue;
    const fields = parseFrontmatter(text);
    if (fields["user-invocable"] === "false") continue;
    rows.push({
      name: prefix + (fields.name || folder),
      description: fields.description ?? "",
    });
  }
  return rows;
}

async function readCommands(
  dir: string,
  prefix: string,
): Promise<SlashCommand[]> {
  const rows: SlashCommand[] = [];
  for (const file of await readDir(dir)) {
    if (!file.endsWith(".md")) continue;
    const text = await readText(path.join(dir, file));
    if (text === null) continue;
    rows.push({
      name: prefix + file.slice(0, -3),
      description: parseFrontmatter(text).description ?? "",
    });
  }
  return rows;
}

async function readRoot(root: string, prefix = ""): Promise<SlashCommand[]> {
  return [
    ...(await readSkills(path.join(root, "skills"), prefix)),
    ...(await readCommands(path.join(root, "commands"), prefix)),
  ];
}

async function enabledPluginRoots(home: string): Promise<[string, string][]> {
  const claudeDir = path.join(home, ".claude");
  const settings = (await readJson(path.join(claudeDir, "settings.json"))) as {
    enabledPlugins?: Record<string, unknown>;
  } | null;
  const installed = (await readJson(
    path.join(claudeDir, "plugins", "installed_plugins.json"),
  )) as { plugins?: Record<string, { installPath?: unknown }[]> } | null;
  const roots: [string, string][] = [];
  for (const [key, entries] of Object.entries(installed?.plugins ?? {})) {
    if (settings?.enabledPlugins?.[key] !== true) continue;
    const installPath = Array.isArray(entries) ? entries[0]?.installPath : null;
    if (typeof installPath !== "string") continue;
    roots.push([key.split("@")[0], installPath]);
  }
  return roots;
}

/** Skills and custom commands a Claude Code session in `cwd` offers, first name wins. */
export async function listSlashCommands(
  cwd: string,
  home: string,
): Promise<SlashCommand[]> {
  const groups = [
    await readRoot(path.join(cwd, ".claude")),
    await readRoot(path.join(home, ".claude")),
  ];
  for (const [plugin, installPath] of await enabledPluginRoots(home))
    groups.push(await readRoot(installPath, `${plugin}:`));
  const byName = new Map<string, SlashCommand>();
  for (const row of groups.flat())
    if (!byName.has(row.name)) byName.set(row.name, row);
  return [...byName.values()];
}
