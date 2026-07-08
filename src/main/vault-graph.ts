import { promises as fs } from "node:fs";
import path from "node:path";
import type {
  VaultGraph,
  GraphNode,
  GraphEdge,
  Section,
} from "../shared/types";

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
  const noteIds = files.map((f) => toNodeId(rootPath, f.abs));

  const byPath = new Set(noteIds);
  // Initialize a case-insensitive path lookup map
  const byPathLower = new Map<string, string>();
  for (const id of noteIds) {
    byPathLower.set(id.toLowerCase(), id);
  }

  // Obsidian-style shortest-link resolution: basename → id
  // ponytail: ambiguous basenames resolve to first found; good enough for v1
  const byBasename = new Map<string, string>();
  for (const id of noteIds) {
    const parts = id.split("/");
    const base = (parts[parts.length - 1] || "").toLowerCase();
    if (!byBasename.has(base)) byBasename.set(base, id);
  }

  const nodes: GraphNode[] = files.map((f, i) => ({
    id: noteIds[i],
    type: "note",
    domain: f.domain,
    section: f.section,
  }));
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
    const text = await fs.readFile(files[i].abs, "utf8");

    for (const m of text.matchAll(WIKILINK)) {
      const target = resolveWikilink(
        m[1].trim(),
        byPath,
        byBasename,
        byPathLower,
      );
      if (target) addEdge(sourceId, target); // unresolved → skipped, no ghost nodes
    }
    for (const m of text.matchAll(MDLINK)) {
      const target = resolveMdLink(m[1], sourceId, byPath, byPathLower);
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

type MdFile = { abs: string; domain: string; section: Section };

// only <domain>/raw/**.md and <domain>/wiki/**.md are graph nodes
async function collectMdFiles(rootPath: string): Promise<MdFile[]> {
  const out: MdFile[] = [];
  const top = await fs.readdir(rootPath, { withFileTypes: true });
  for (const d of top) {
    if (!d.isDirectory() || d.name.startsWith(".")) continue;
    for (const section of ["raw", "wiki"] as Section[]) {
      const dir = path.join(rootPath, d.name, section);
      for (const abs of await walkMd(dir)) {
        out.push({ abs, domain: d.name, section });
      }
    }
  }
  return out;
}

async function walkMd(dir: string): Promise<string[]> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return []; // domain has no raw/ or wiki/ folder — contributes nothing
  }
  const out: string[] = [];
  for (const e of entries) {
    if (e.name.startsWith(".")) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walkMd(full)));
    else if (e.name.toLowerCase().endsWith(".md")) out.push(full);
  }
  return out;
}

export function resolveWikilink(
  target: string,
  byPath: Set<string>,
  byBasename: Map<string, string>,
  byPathLower: Map<string, string>,
): string | null {
  const clean = target.replace(/\.md$/i, "");
  if (byPath.has(clean)) return clean;

  const cleanLower = clean.toLowerCase();
  const caseInsensitivePath = byPathLower.get(cleanLower);
  if (caseInsensitivePath) return caseInsensitivePath;

  const parts = cleanLower.split("/");
  const base = parts[parts.length - 1] || "";
  return byBasename.get(base) ?? null;
}

export function resolveMdLink(
  href: string,
  sourceId: string,
  byPath: Set<string>,
  byPathLower: Map<string, string>,
): string | null {
  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return null; // external URL
  let decoded: string;
  try {
    decoded = decodeURI(href);
  } catch {
    decoded = href;
  }
  decoded = decoded.replace(/\.md$/i, "");
  const sourceDir = sourceId.includes("/")
    ? sourceId.slice(0, sourceId.lastIndexOf("/"))
    : "";
  const resolved = path.posix.normalize(path.posix.join(sourceDir, decoded));

  if (byPath.has(resolved)) return resolved;
  const resolvedLower = resolved.toLowerCase();
  const caseInsensitiveResolved = byPathLower.get(resolvedLower);
  if (caseInsensitiveResolved) return caseInsensitiveResolved;

  // also accept vault-root-relative links
  if (byPath.has(decoded)) return decoded;
  const decodedLower = decoded.toLowerCase();
  const caseInsensitiveDecoded = byPathLower.get(decodedLower);
  if (caseInsensitiveDecoded) return caseInsensitiveDecoded;

  return null;
}
