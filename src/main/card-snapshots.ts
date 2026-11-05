import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  SNAPSHOT_FORMAT,
  type CardLayout,
  type StoredSnapshot,
  type VaultGraph,
  type Workspace,
} from "../shared/types";

const MAX_BODY_BYTES = 1024 * 1024;

export function snapshotFile(dir: string, id: string): string {
  const name = createHash("sha1").update(id).digest("hex").slice(0, 16);
  return path.join(dir, `${name}.json`);
}

export async function deleteSnapshot(dir: string, id: string): Promise<void> {
  await fs.rm(snapshotFile(dir, id), { force: true });
}

// The fingerprint is read before the load, so an index rebuilt mid-load
// leaves the graph with the older fingerprint, which the next read rejects.
export async function loadFingerprinted(
  load: () => Promise<VaultGraph>,
  fingerprint: () => Promise<string | null>,
): Promise<VaultGraph> {
  const fp = await fingerprint().catch(() => null);
  const g = await load();
  return fp === null ? g : { ...g, fingerprint: fp };
}

const finite = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);

// The renderer paints a stored layout without checking it, so every field
// the paint reads is checked here.
function isLayout(v: unknown): v is CardLayout {
  const l = v as CardLayout | null;
  if (!l || typeof l !== "object") return false;
  if (!finite(l.width) || l.width <= 0 || !finite(l.height) || l.height <= 0)
    return false;
  const t = l.transform;
  if (!t || !finite(t.k) || t.k <= 0 || !finite(t.x) || !finite(t.y))
    return false;
  if (!Array.isArray(l.nodes) || !Array.isArray(l.links)) return false;
  const nodesOk = l.nodes.every(
    (n) =>
      !!n &&
      typeof n === "object" &&
      typeof n.id === "string" &&
      typeof n.hk === "string" &&
      typeof n.fill === "string" &&
      finite(n.x) &&
      finite(n.y) &&
      finite(n.r),
  );
  const index = (i: unknown) =>
    Number.isInteger(i) && (i as number) >= 0 && (i as number) < l.nodes.length;
  return (
    nodesOk &&
    l.links.every(
      (k) => Array.isArray(k) && k.length === 2 && index(k[0]) && index(k[1]),
    )
  );
}

function isStored(v: unknown): v is StoredSnapshot {
  const s = v as StoredSnapshot | null;
  return (
    !!s &&
    s.format === SNAPSHOT_FORMAT &&
    typeof s.id === "string" &&
    typeof s.fingerprint === "string" &&
    typeof s.look === "string" &&
    isLayout(s.layout)
  );
}

// A file that cannot be trusted is deleted rather than thrown on, so one bad
// file never blocks startup and is not re-read on the next visit. A `.tmp`
// left by a save that died before its rename is deleted too.
export async function readSnapshots(
  dir: string,
  workspaces: Workspace[],
  fingerprintOf: (ws: Workspace) => Promise<string | null>,
): Promise<StoredSnapshot[]> {
  const names = await fs.readdir(dir).catch(() => [] as string[]);
  const out: StoredSnapshot[] = [];
  for (const name of names) {
    if (name.endsWith(".tmp")) {
      await fs.rm(path.join(dir, name), { force: true });
      continue;
    }
    if (!name.endsWith(".json")) continue;
    const file = path.join(dir, name);
    let stored: StoredSnapshot | null = null;
    try {
      const parsed: unknown = JSON.parse(await fs.readFile(file, "utf8"));
      if (isStored(parsed)) stored = parsed;
    } catch {
      // corrupt or unreadable: falls through to the delete
    }
    const ws = stored && workspaces.find((w) => w.id === stored!.id);
    if (stored && ws && !ws.isSelf) {
      const current = await fingerprintOf(ws).catch(() => null);
      if (current !== null && current === stored.fingerprint) out.push(stored);
      else stored = null;
    } else stored = null;
    if (!stored) await fs.rm(file, { force: true });
  }
  return out;
}

// The fingerprint is the one main stamped on the graph the card drew, so a
// layout of a graph rebuilt since then is stored under a fingerprint the next
// read rejects.
export async function saveSnapshot(
  dir: string,
  ws: Workspace | undefined,
  body: { look: string; layout: CardLayout; fingerprint?: string },
): Promise<boolean> {
  if (!ws || ws.isSelf) return false;
  const fingerprint = body?.fingerprint;
  if (typeof fingerprint !== "string" || fingerprint === "") return false;
  if (typeof body.look !== "string" || !isLayout(body.layout)) return false;
  if (body.layout.nodes.length === 0) return false;
  const json = JSON.stringify({
    format: SNAPSHOT_FORMAT,
    id: ws.id,
    fingerprint,
    look: body.look,
    layout: body.layout,
  });
  if (Buffer.byteLength(json) > MAX_BODY_BYTES) return false;
  const file = snapshotFile(dir, ws.id);
  // one tmp name per save, so two saves in flight never share a file
  const tmp = `${file}.${randomUUID()}.tmp`;
  // Windows refuses a rename onto a file another rename is still replacing
  // (EPERM), so saves of one file queue behind each other in call order and
  // the last wins. Nothing is awaited before the save joins the queue.
  const run = (saving.get(file) ?? Promise.resolve()).then(async () => {
    await fs.mkdir(dir, { recursive: true });
    try {
      await fs.writeFile(tmp, json, "utf8");
      await fs.rename(tmp, file);
    } catch (err) {
      await fs.rm(tmp, { force: true });
      throw err;
    }
  });
  const tail = run.catch(() => undefined);
  saving.set(file, tail);
  void tail.then(() => {
    if (saving.get(file) === tail) saving.delete(file);
  });
  await run;
  return true;
}

// the newest save of each snapshot file, which the next save waits for
const saving = new Map<string, Promise<void>>();
