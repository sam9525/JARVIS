import type { Workspace } from "../shared/types";

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
  onData(workspaceId: string, data: string): void;
  onExit(workspaceId: string, exitCode: number): void;
}

/** The aliases `--model` accepts. An unlisted string passes no flag at all,
 * so a renderer bug cannot place arbitrary text on the command line. */
export const CLAUDE_MODELS = ["fable", "opus", "sonnet", "haiku"] as const;

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
  return {
    launch(
      ws: Workspace,
      cols: number,
      rows: number,
      dangerous = false,
      model?: string,
      resume: boolean | string = false,
    ): void {
      if (ptys.has(ws.id)) return; // one live session per workspace
      const { file, args } = claudeCommand(dangerous, model, resume);
      const p = spawnFn(file, args, {
        cwd: ws.rootPath,
        cols,
        rows,
        env: process.env,
      });
      ptys.set(ws.id, p);
      p.onData((d) => events.onData(ws.id, d));
      p.onExit(({ exitCode }) => {
        ptys.delete(ws.id);
        events.onExit(ws.id, exitCode);
      });
    },
    write(id: string, data: string): boolean {
      const p = ptys.get(id);
      if (!p) return false;
      p.write(data);
      return true;
    },
    has(id: string): boolean {
      return ptys.has(id);
    },
    resize(id: string, cols: number, rows: number): void {
      ptys.get(id)?.resize(cols, rows);
    },
    killAll(): void {
      for (const p of ptys.values()) p.kill();
      ptys.clear();
    },
  };
}
