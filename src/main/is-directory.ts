import { promises as fs } from "node:fs";

// "does this path exist and is it a folder" — a missing path, a file, or an
// unreadable one all answer false, so callers never need their own try/catch.
export function isDirectory(p: string): Promise<boolean> {
  return fs.stat(p).then(
    (s) => s.isDirectory(),
    () => false,
  );
}
