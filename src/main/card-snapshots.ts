import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  SNAPSHOT_FORMAT,
  type CardLayout,
  type StoredSnapshot,
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

function isStored(v: unknown): v is StoredSnapshot {
  const s = v as StoredSnapshot | null;
  return (
    !!s &&
    s.format === SNAPSHOT_FORMAT &&
    typeof s.id === "string" &&
    typeof s.fingerprint === "string" &&
    typeof s.look === "string" &&
    Array.isArray(s.layout?.nodes)
  );
}

// A file that cannot be trusted is deleted rather than thrown on, so one bad
// file never blocks startup and is not re-read on the next visit.
export async function readSnapshots(
  dir: string,
  workspaces: Workspace[],
  fingerprintOf: (ws: Workspace) => Promise<string | null>,
): Promise<StoredSnapshot[]> {
  const names = await fs.readdir(dir).catch(() => [] as string[]);
  const out: StoredSnapshot[] = [];
  for (const name of names) {
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

export async function saveSnapshot(
  dir: string,
  ws: Workspace | undefined,
  body: { look: string; layout: CardLayout },
  fingerprint: string | null,
): Promise<boolean> {
  if (!ws || ws.isSelf || fingerprint === null) return false;
  if (!body?.layout?.nodes?.length) return false;
  const json = JSON.stringify({
    format: SNAPSHOT_FORMAT,
    id: ws.id,
    fingerprint,
    look: body.look,
    layout: body.layout,
  });
  if (Buffer.byteLength(json) > MAX_BODY_BYTES) return false;
  const file = snapshotFile(dir, ws.id);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(`${file}.tmp`, json, "utf8");
  await fs.rename(`${file}.tmp`, file);
  return true;
}
