import { execFileSync } from "node:child_process";

type Run = (file: string, args: string[]) => string;

const MARK = "__JARVIS_PATH__";

const runShell: Run = (file, args) =>
  execFileSync(file, args, { encoding: "utf8", timeout: 5000 });

/**
 * The PATH a login shell would see. A macOS app opened from Finder or the
 * Dock inherits launchd's bare `/usr/bin:/bin:/usr/sbin:/sbin`, so `claude`,
 * `node` and `gitnexus` installed by Homebrew or nvm never resolve. Returns
 * null on Windows, which has no such split, and when the shell fails.
 */
export function loginShellPath(
  platform: NodeJS.Platform = process.platform,
  shell: string = process.env.SHELL || "/bin/zsh",
  run: Run = runShell,
): string | null {
  if (platform === "win32") return null;
  try {
    // An interactive shell may print a banner first, so the PATH is fenced.
    // printenv, not `echo $PATH`: fish expands $PATH to space-separated words.
    const out = run(shell, [
      "-ilc",
      `printf %s ${MARK}; printenv PATH; printf %s ${MARK}`,
    ]);
    return out.split(MARK)[1]?.trim() || null;
  } catch {
    return null;
  }
}
