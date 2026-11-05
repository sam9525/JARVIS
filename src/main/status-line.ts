import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { StatusLineView } from "../shared/types";

type Json = Record<string, unknown>;

const obj = (v: unknown): Json =>
  typeof v === "object" && v !== null ? (v as Json) : {};
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;
const floored = (v: unknown): number | null => {
  const n = num(v);
  return n === null ? null : Math.floor(n);
};

export function toStatusLineView(
  raw: Json,
  git: { branch: string; commit: string },
): StatusLineView {
  const limits = obj(raw.rate_limits);
  const fiveHour = obj(limits.five_hour);
  const sevenDay = obj(limits.seven_day);
  const dir = str(obj(raw.workspace).current_dir);
  return {
    model: str(obj(raw.model).display_name),
    effort: str(obj(raw.effort).level),
    folder: dir.split(/[\\/]/).filter(Boolean).pop() ?? "",
    branch: git.branch,
    commit: git.commit,
    contextPct: floored(obj(raw.context_window).used_percentage),
    fiveHourPct: floored(fiveHour.used_percentage),
    fiveHourResetsAt: num(fiveHour.resets_at),
    sevenDayPct: floored(sevenDay.used_percentage),
    sevenDayResetsAt: num(sevenDay.resets_at),
  };
}

function git(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve) => {
    execFile(
      "git",
      args,
      { cwd, windowsHide: true, timeout: 5000 },
      (err, stdout) => resolve(err ? "" : stdout.trim()),
    );
  });
}

export async function gitHead(
  cwd: string,
): Promise<{ branch: string; commit: string }> {
  const [branch, commit] = await Promise.all([
    git(cwd, ["branch", "--show-current"]),
    git(cwd, ["log", "-1", "--pretty=%s"]),
  ]);
  return { branch, commit };
}

// null = the user has their own status line; leave their file alone
export function withStatusLine(settings: Json, command: string): Json | null {
  if (settings.statusLine !== undefined) {
    const existing = str(obj(settings.statusLine).command);
    if (!existing.includes("statusline.mjs")) return null;
  }
  return { ...settings, statusLine: { type: "command", command } };
}

async function statusLineCommand(file: string): Promise<string | null> {
  try {
    const parsed = JSON.parse(await fs.readFile(file, "utf8")) as unknown;
    const command = str(obj(obj(parsed).statusLine).command);
    return command || null;
  } catch {
    return null;
  }
}

export async function userStatusLine(
  home: string,
  root: string,
): Promise<string | null> {
  return (
    (await statusLineCommand(path.join(root, ".claude", "settings.json"))) ??
    (await statusLineCommand(path.join(home, ".claude", "settings.json")))
  );
}
