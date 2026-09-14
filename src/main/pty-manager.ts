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

// Windows can't spawn `claude` (a .cmd shim) without a shell.
export function claudeCommand(
  dangerous = false,
  model?: string,
  continueSession = false,
): { file: string; args: string[] } {
  const flags = dangerous ? ["--dangerously-skip-permissions"] : [];
  if (model && (CLAUDE_MODELS as readonly string[]).includes(model))
    flags.push("--model", model);
  // resumes the newest conversation in this cwd; the caller checks a
  // transcript exists first, so a fresh folder never asks for one
  if (continueSession) flags.push("--continue");
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
      continueSession = false,
    ): void {
      if (ptys.has(ws.id)) return; // one live session per workspace
      const { file, args } = claudeCommand(dangerous, model, continueSession);
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
