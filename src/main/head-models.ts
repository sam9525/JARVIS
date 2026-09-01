import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * Uploaded head models, kept flat beside the settings file.
 *
 * The renderer never touches these paths: it asks for a name and gets bytes,
 * the same reason `tts.ts` runs in main. `Settings.headModel` holds the name;
 * absent means the built-in helmet in `public/head/`.
 */
export const headsDir = (userData: string) => path.join(userData, "heads");

/**
 * The largest head worth accepting.
 *
 * The whole file crosses IPC as one array and is parsed on the window's own
 * thread, so an oversized model does not fail slowly — it takes the renderer
 * down with it. Refusing it here is the only place a person still gets told.
 *
 * ponytail: a flat byte cap; stream the file to the renderer if a real head
 * ever needs to be bigger than this.
 */
export const MAX_HEAD_BYTES = 256 * 1024 * 1024;

/**
 * A stored name reduced to a plain `.glb` file inside that one folder — the
 * name arrives from the renderer, so it can never be allowed to walk out.
 */
export function safeName(file: string): string {
  const base = path.basename(file).replace(/[^\w.-]+/g, "_") || "head.glb";
  return /\.glb$/i.test(base) ? base : `${base}.glb`;
}

export async function listHeads(userData: string): Promise<string[]> {
  try {
    const names = await fs.readdir(headsDir(userData));
    return names.filter((n) => /\.glb$/i.test(n)).sort();
  } catch {
    return []; // nothing uploaded yet
  }
}

/** Copy a picked file into the folder and hand back the name it got. */
export async function importHead(
  userData: string,
  src: string,
): Promise<string> {
  const { size } = await fs.stat(src);
  if (size > MAX_HEAD_BYTES)
    throw new Error(
      `that model is ${mb(size)}, and the head reads up to ${mb(MAX_HEAD_BYTES)}`,
    );
  const dir = headsDir(userData);
  await fs.mkdir(dir, { recursive: true });
  const name = await freeName(dir, safeName(src), size);
  await fs.copyFile(src, path.join(dir, name));
  return name;
}

const mb = (bytes: number) => `${Math.round(bytes / 1024 / 1024)} MB`;

/**
 * The name this upload may have without displacing a different head.
 *
 * A new file must never land on an older one's name: the renderer caches a
 * parsed head by name and holds it for the session, so an overwrite leaves the
 * app drawing the head it already had. The same file picked twice keeps the
 * name it has rather than piling up copies of itself.
 *
 * Same name and same length counts as the same head. Comparing the bytes would
 * be exact, but it means reading a quarter of a gigabyte on every upload — and
 * two different heads of identical byte length costs one stale head, which a
 * rename fixes.
 */
async function freeName(
  dir: string,
  base: string,
  size: number,
): Promise<string> {
  const ext = path.extname(base);
  const stem = base.slice(0, base.length - ext.length);
  for (let n = 1; n < 100; n++) {
    const name = n === 1 ? base : `${stem}-${n}${ext}`;
    const held = await fs.stat(path.join(dir, name)).catch(() => null);
    if (!held || held.size === size) return name;
  }
  return base; // a hundred heads under one name: reuse rather than grow forever
}

export async function readHead(
  userData: string,
  name: string,
): Promise<Uint8Array | null> {
  try {
    const file = path.join(headsDir(userData), safeName(name));
    // The cap is checked again here, not only on import: a file can be dropped
    // into the folder by hand, or grow after the import stat, and this is the
    // read that hands a whole model to the window in one array.
    const { size } = await fs.stat(file);
    if (size > MAX_HEAD_BYTES) return null;
    return new Uint8Array(await fs.readFile(file));
  } catch {
    return null; // deleted behind our back, or never there
  }
}
