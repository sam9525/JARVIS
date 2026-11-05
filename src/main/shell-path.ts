import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

type Run = (file: string, args: string[]) => string;

const MARK = "__JARVIS_PATH__";

const runShell: Run = (file, args) =>
  execFileSync(file, args, {
    encoding: "utf8",
    timeout: 5000,
    windowsHide: true,
  });

/**
 * The PATH a login shell would see. A macOS app opened from Finder or the
 * Dock inherits launchd's bare `/usr/bin:/bin:/usr/sbin:/sbin`, so `claude`,
 * `node` and `gitnexus` installed by Homebrew or nvm never resolve. Returns
 * null on Windows, where `windowsPath` applies, and when the shell fails.
 * POSIX only.
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

/**
 * The PATH Windows stores: Machine then User. The inherited `process.env.PATH`
 * holds whatever the parent app passed down, which can lack entries a fresh
 * terminal would have. WinGet's Links folder is appended when it exists,
 * because the stored PATH can omit it. Returns null when PowerShell fails or
 * the stored PATH is empty.
 */
export function windowsPath(
  run: Run = runShell,
  folderExists: (dir: string) => boolean = existsSync,
  localAppData: string | undefined = process.env.LOCALAPPDATA,
): string | null {
  try {
    // Base64 of UTF-16 keeps non-ASCII folder names intact across the console
    // code page; the script has no double quotes, which Node escapes in
    // Windows arguments.
    const script =
      `$p = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + ` +
      `[Environment]::GetEnvironmentVariable('Path','User'); ` +
      `'${MARK}' + [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($p)) + '${MARK}'`;
    const out = run("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      script,
    ]);
    const encoded = out.split(MARK)[1];
    if (!encoded) return null;
    const entries = Buffer.from(encoded, "base64")
      .toString("utf16le")
      .split(";")
      .map((entry) => entry.replaceAll('"', ""))
      .filter(Boolean);
    if (entries.length === 0) return null;
    if (localAppData) {
      const links = path.win32.join(
        localAppData,
        "Microsoft",
        "WinGet",
        "Links",
      );
      if (folderExists(links)) entries.push(links);
    }
    return entries.join(";");
  } catch {
    return null;
  }
}
