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
  const dir = headsDir(userData);
  await fs.mkdir(dir, { recursive: true });
  const bytes = await fs.readFile(src);
  const name = await freeName(dir, safeName(src), bytes);
  await fs.writeFile(path.join(dir, name), bytes);
  return name;
}

/**
 * The name this upload may have without displacing a different head.
 *
 * A new file must never land on an older one's name: the renderer caches a
 * parsed head by name and holds it for the session, so an overwrite leaves the
 * app drawing the head it already had. The same file picked twice keeps the
 * name it has rather than piling up copies of itself.
 */
async function freeName(
  dir: string,
  base: string,
  bytes: Buffer,
): Promise<string> {
  const ext = path.extname(base);
  const stem = base.slice(0, base.length - ext.length);
  for (let n = 1; n < 100; n++) {
    const name = n === 1 ? base : `${stem}-${n}${ext}`;
    const held = await fs.readFile(path.join(dir, name)).catch(() => null);
    if (!held || held.equals(bytes)) return name;
  }
  return base; // a hundred heads under one name: reuse rather than grow forever
}

export async function readHead(
  userData: string,
  name: string,
): Promise<Uint8Array | null> {
  try {
    const buf = await fs.readFile(
      path.join(headsDir(userData), safeName(name)),
    );
    return new Uint8Array(buf);
  } catch {
    return null; // deleted behind our back, or never there
  }
}
