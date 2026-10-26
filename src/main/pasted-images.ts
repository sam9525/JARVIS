import { promises as fs } from "node:fs";
import path from "node:path";

const MAX_BYTES = 20 * 1024 * 1024;

export async function savePastedImage(
  dir: string,
  bytes: Uint8Array,
  ext: "png" | "jpg" | "gif" | "webp",
  now: number,
): Promise<string> {
  if (bytes.byteLength > MAX_BYTES)
    throw new Error("pasted image is over 20 MiB");
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, `pasted-${now}.${ext}`);
  await fs.writeFile(file, bytes);
  return file;
}
