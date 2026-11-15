import type { AgentAdapter } from ".";
import { isSessionId } from "../../shared/session-id";
import { ensureHooks } from "../hook-install";
import { ensureMcp } from "../mcp-install";

/** The aliases `--model` accepts. An unlisted string passes no flag at all,
 * so a renderer bug cannot place arbitrary text on the command line. */
export const CLAUDE_MODELS = ["fable", "opus", "sonnet", "haiku"] as const;

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

export const claudeAdapter: AgentAdapter = {
  id: "claude",
  features: {
    transcript: true,
    askPanel: true,
    permissionCard: true,
    statusLine: true,
    slashList: true,
    trustCheck: true,
    resume: true,
  },
  command: async ({ dangerous, model, resume }) =>
    claudeCommand(dangerous, model, resume),
  prepare: async ({ cwd, ws, forwardPath, mcpPath }) => {
    const hooksOk = await ensureHooks(cwd, forwardPath);
    const mcpOk = await ensureMcp(ws, mcpPath);
    return hooksOk && mcpOk;
  },
  normalize: (raw) => [raw],
};
