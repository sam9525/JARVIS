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
  const name = safeName(src);
  await fs.copyFile(src, path.join(dir, name));
  return name;
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
