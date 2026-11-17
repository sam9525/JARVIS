import { posix } from "node:path";

/** A hook path with `/` only. A `\\?\` prefix (resumed sessions) is dropped,
 * and a relative path is joined to cwd. */
export function filePathOf(raw: string, cwd: unknown): string {
  const slashed = raw.replace(/^\\\\\?\\/, "").replace(/\\/g, "/");
  const absolute = /^[A-Za-z]:/.test(slashed) || slashed.startsWith("/");
  if (absolute || typeof cwd !== "string") return slashed;
  return posix.join(cwd.replace(/\\/g, "/"), slashed);
}
