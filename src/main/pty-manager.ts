// Structural subset of node-pty's IPty — lets tests inject fakes and keeps
// this module free of the native import (index.ts injects the real spawn).
export interface PtyLike {
  onData(cb: (data: string) => void): void;
  onExit(cb: (e: { exitCode: number }) => void): void;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
}

export interface SpawnOpts {
  cwd: string;
  cols: number;
  rows: number;
  env: Record<string, string | undefined>;
}

export type SpawnFn = (
  file: string,
  args: string[],
  opts: SpawnOpts,
) => PtyLike;

export interface PtyManagerEvents {
  onData(key: string, data: string): void;
  onExit(key: string, exitCode: number): void;
}

/** The aliases `--model` accepts. An unlisted string passes no flag at all,
 * so a renderer bug cannot place arbitrary text on the command line. */
export const CLAUDE_MODELS = ["fable", "opus", "sonnet", "haiku"] as const;

/** How long `kill` waits for the process to exit before resolving anyway. */
export const KILL_WAIT_MS = 3000;

export const isSessionId = (s: string): boolean =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

// Windows can't spawn `claude` (a .cmd shim) without a shell.
export function claudeCommand(
  dangerous = false,
  model?: string,
  resume: boolean | string = false,
): { file: string; args: string[] } {
  const flags = dangerous ? ["--dangerously-skip-permissions"] : [];
  if (model && (CLAUDE_MODELS as readonly string[]).includes(model))
    flags.push("--model", model);
  // true resumes the newest conversation in this cwd, a string resumes that
  // session id; the caller checks a transcript exists first. The id must be a
  // UUID because `cmd.exe /c` would run anything after a `&`.
  if (resume === true) flags.push("--continue");
  else if (typeof resume === "string" && isSessionId(resume))
    flags.push("--resume", resume);
  return process.platform === "win32"
    ? { file: "cmd.exe", args: ["/c", "claude", ...flags] }
    : { file: "claude", args: flags };
}

export function createPtyManager(spawnFn: SpawnFn, events: PtyManagerEvents) {
  const ptys = new Map<string, PtyLike>();
  // a killed pty's exit resolves its kill instead of reaching events.onExit
  const exitWaiters = new Map<PtyLike, () => void>();
  return {
    launch(
      key: string,
      cwd: string,
      cols: number,
      rows: number,
      dangerous = false,
      model?: string,
      resume: boolean | string = false,
      statusLine?: string,
    ): void {
      if (ptys.has(key)) return; // one live pty per session key
      const { file, args } = claudeCommand(dangerous, model, resume);
      // an app started from inside a JARVIS terminal inherits that session's
      // JARVIS_STATUSLINE, so the inherited value is dropped, not passed on
      const parentEnv = { ...process.env };
      delete parentEnv.JARVIS_STATUSLINE;
      const p = spawnFn(file, args, {
        cwd,
        cols,
        rows,
        // the hook forwarder reads JARVIS_SESSION to tag its events; the
        // status line wrapper reads JARVIS_STATUSLINE for the user's own command
        env: {
          ...parentEnv,
          JARVIS_SESSION: key,
          ...(typeof statusLine === "string"
            ? { JARVIS_STATUSLINE: statusLine }
            : {}),
        },
      });
      ptys.set(key, p);
      p.onData((d) => events.onData(key, d));
      p.onExit(({ exitCode }) => {
        // a killed pty's late exit must not remove a relaunch of the same key
        if (ptys.get(key) !== p) {
          exitWaiters.get(p)?.();
          return;
        }
        ptys.delete(key);
        events.onExit(key, exitCode);
      });
    },
    write(key: string, data: string): boolean {
      const p = ptys.get(key);
      if (!p) return false;
      p.write(data);
      return true;
    },
    has(key: string): boolean {
      return ptys.has(key);
    },
    keys(): string[] {
      return [...ptys.keys()];
    },
    resize(key: string, cols: number, rows: number): void {
      ptys.get(key)?.resize(cols, rows);
    },
    /** Resolves once the process has exited — a dying process still holds
     * its cwd, and Windows refuses to remove that folder — or at
     * KILL_WAIT_MS if no exit comes. False when no pty has the key. */
    kill(key: string): Promise<boolean> {
      const p = ptys.get(key);
      if (!p) return Promise.resolve(false);
      ptys.delete(key);
      const exited = new Promise<boolean>((resolve) => {
        const done = () => {
          clearTimeout(timer);
          exitWaiters.delete(p);
          resolve(true);
        };
        const timer = setTimeout(done, KILL_WAIT_MS);
        exitWaiters.set(p, done);
      });
      p.kill();
      return exited;
    },
    killAll(): void {
      for (const p of ptys.values()) p.kill();
      ptys.clear();
    },
  };
}
