import { promises as fs } from "node:fs";

/** Size past which the next write starts the file over. */
export const LOG_CAP_BYTES = 262_144;

/** Appends one timestamped line, starting the file over once it is past
 * LOG_CAP_BYTES. Never throws: a diagnostic log must not break what it logs. */
export async function appendCapped(
  file: string,
  line: string,
  now: Date = new Date(),
): Promise<void> {
  try {
    const size = await fs.stat(file).then(
      (s) => s.size,
      () => 0,
    );
    const write = size > LOG_CAP_BYTES ? fs.writeFile : fs.appendFile;
    await write(file, `${now.toISOString()} ${line}\n`);
  } catch (err) {
    console.warn("[edge] log write failed:", err);
  }
}
