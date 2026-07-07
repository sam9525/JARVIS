import { promises as fs } from "node:fs";
import path from "node:path";
import type { VaultGraph, GraphNode, GraphEdge } from "../shared/types";

// [[target]], [[target#heading]], [[target|alias]]
const WIKILINK = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g;
// [text](relative/path.md)
const MDLINK = /\[[^\]]*\]\(([^)]+\.md)\)/g;
// #tag at line start or after whitespace
// ponytail: also matches inside code blocks/frontmatter; exclude fenced blocks if it ever misfires
const TAG = /(^|\s)#([A-Za-z][\w/-]*)/gm;

export function toNodeId(rootPath: string, absPath: string): string {
  return path
    .relative(rootPath, absPath)
    .split(path.sep)
    .join("/")
    .replace(/\.md$/i, "");
}

export async function scanVault(rootPath: string): Promise<VaultGraph> {
  const files = await collectMdFiles(rootPath);
  const noteIds = files.map((f) => toNodeId(rootPath, f));

  const byPath = new Set(noteIds);
  // Obsidian-style shortest-link resolution: basename → id
  // ponytail: ambiguous basenames resolve to first found; good enough for v1
  const byBasename = new Map<string, string>();
  for (const id of noteIds) {
    const parts = id.split("/");
    const base = (parts[parts.length - 1] || "").toLowerCase();
    if (!byBasename.has(base)) byBasename.set(base, id);
  }

  const nodes: GraphNode[] = noteIds.map((id) => ({ id, type: "note" }));
  const edges: GraphEdge[] = [];
  const edgeKeys = new Set<string>();
  const tagIds = new Set<string>();

  const addEdge = (source: string, target: string) => {
    const key = `${source}>${target}`;
    if (source === target || edgeKeys.has(key)) return;
    edgeKeys.add(key);
    edges.push({ source, target });
  };

  for (let i = 0; i < files.length; i++) {
    const sourceId = noteIds[i];
    const text = await fs.readFile(files[i], "utf8");

    for (const m of text.matchAll(WIKILINK)) {
      const target = resolveWikilink(m[1].trim(), byPath, byBasename);
      if (target) addEdge(sourceId, target); // unresolved → skipped, no ghost nodes
    }
    for (const m of text.matchAll(MDLINK)) {
      const target = resolveMdLink(m[1], sourceId, byPath);
      if (target) addEdge(sourceId, target);
    }
    for (const m of text.matchAll(TAG)) {
      const tagId = `tag:${m[2]}`;
      tagIds.add(tagId);
      addEdge(sourceId, tagId);
    }
  }

  for (const tagId of tagIds) nodes.push({ id: tagId, type: "tag" });
  return { nodes, edges };
}

async function collectMdFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    if (e.name.startsWith(".")) continue; // .obsidian, .git, .claude
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await collectMdFiles(full)));
    else if (e.name.toLowerCase().endsWith(".md")) out.push(full);
  }
  return out;
}

function resolveWikilink(
  target: string,
  byPath: Set<string>,
  byBasename: Map<string, string>,
): string | null {
  const clean = target.replace(/\.md$/i, "");
  if (byPath.has(clean)) return clean;
  const parts = clean.toLowerCase().split("/");
  const base = parts[parts.length - 1] || "";
  return byBasename.get(base) ?? null;
}

function resolveMdLink(
  href: string,
  sourceId: string,
  byPath: Set<string>,
): string | null {
  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return null; // external URL
  const decoded = decodeURI(href).replace(/\.md$/i, "");
  const sourceDir = sourceId.includes("/")
    ? sourceId.slice(0, sourceId.lastIndexOf("/"))
    : "";
  const resolved = path.posix.normalize(path.posix.join(sourceDir, decoded));
  if (byPath.has(resolved)) return resolved;
  // also accept vault-root-relative links
  return byPath.has(decoded) ? decoded : null;
}
