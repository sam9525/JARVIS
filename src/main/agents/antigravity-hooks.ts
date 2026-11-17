import { promises as fs } from "node:fs";
import path from "node:path";
import { isSessionId } from "../../shared/session-id";

const PLAIN_EVENTS = ["SessionStart", "PreInvocation", "Stop"];
const TOOL_EVENTS = ["PreToolUse", "PostToolUse"];

/** The `.agents/hooks.json` text that registers forward.mjs for each
 * Antigravity hook event. The path uses `/` so it holds no JSON escapes. */
export function antigravityHooksJson(forwardPath: string): string {
  const hook = {
    type: "command",
    command: `node "${forwardPath.replace(/\\/g, "/")}"`,
    timeout: 5,
  };
  const jarvis: Record<string, unknown> = {};
  for (const event of PLAIN_EVENTS) jarvis[event] = [hook];
  for (const event of TOOL_EVENTS)
    jarvis[event] = [{ matcher: "*", hooks: [hook] }];
  return JSON.stringify({ jarvis }, null, 2) + "\n";
}

/** Writes `<hooksRoot>/.agents/hooks.json` unless it already holds the same
 * text. Returns false when the folder or the file cannot be written. */
export async function ensureAntigravityHooks(
  hooksRoot: string,
  forwardPath: string,
): Promise<boolean> {
  const agentsDir = path.join(hooksRoot, ".agents");
  const hooksPath = path.join(agentsDir, "hooks.json");
  const wanted = antigravityHooksJson(forwardPath);
  const current = await fs.readFile(hooksPath, "utf8").catch(() => null);
  if (current === wanted) return true;
  try {
    await fs.mkdir(agentsDir, { recursive: true });
    await fs.writeFile(hooksPath, wanted);
  } catch {
    return false;
  }
  return true;
}

/** The `agy` arguments: `--add-dir` loads the hooks folder, and the
 * notifications setting makes `agy` send its OSC 9 texts. */
export function antigravityArgs(opts: {
  dangerous: boolean;
  resume: boolean | string;
  hooksRoot: string;
}): string[] {
  const { dangerous, resume, hooksRoot } = opts;
  return [
    ...(dangerous ? ["--dangerously-skip-permissions"] : []),
    "--add-dir",
    hooksRoot,
    "--settings",
    JSON.stringify({ notifications: true }),
    ...(typeof resume === "string" && isSessionId(resume)
      ? ["--conversation", resume]
      : []),
  ];
}
