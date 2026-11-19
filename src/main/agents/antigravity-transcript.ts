import { promises as fs } from "node:fs";
import path from "node:path";

export const NO_FINAL_MESSAGE = "(Antigravity gave no final message)";
export const TRANSCRIPT_TAIL_BYTES = 512 * 1024;

// Windows paths compare equal with either slash and either case.
const comparable = (p: string) => p.replace(/\\/g, "/").toLowerCase();

const isNormalStop = (raw: Record<string, unknown>) =>
  raw.hookEventName === "Stop" &&
  raw.terminationReason === "NO_TOOL_CALL" &&
  (raw.error === undefined || raw.error === "");

function insideBrain(home: string, transcriptPath: string): boolean {
  const brain = comparable(
    path.resolve(home, ".gemini", "antigravity-cli", "brain"),
  );
  return comparable(path.resolve(transcriptPath)).startsWith(brain + "/");
}

async function readTail(file: string): Promise<string> {
  const handle = await fs.open(file, "r");
  try {
    const { size } = await handle.stat();
    const start = Math.max(0, size - TRANSCRIPT_TAIL_BYTES);
    const buffer = Buffer.alloc(size - start);
    await handle.read(buffer, 0, buffer.length, start);
    const text = buffer.toString("utf8");
    // A tail that starts mid-file starts mid-line; that partial line is dropped.
    if (start === 0) return text;
    const firstBreak = text.indexOf("\n");
    return firstBreak === -1 ? "" : text.slice(firstBreak + 1);
  } finally {
    await handle.close();
  }
}

// The scan stops at the last USER_INPUT, so an earlier turn's answer is never
// returned for the current one.
function lastAnswer(text: string): string | null {
  const lines = text.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    let entry: unknown;
    try {
      entry = JSON.parse(lines[i]);
    } catch {
      continue;
    }
    if (typeof entry !== "object" || entry === null) continue;
    const { type, content } = entry as Record<string, unknown>;
    if (type === "USER_INPUT") return null;
    if (
      type === "PLANNER_RESPONSE" &&
      typeof content === "string" &&
      content !== ""
    )
      return content;
  }
  return null;
}

async function finalMessage(
  home: string,
  transcriptPath: unknown,
): Promise<string> {
  if (typeof transcriptPath !== "string" || !insideBrain(home, transcriptPath))
    return NO_FINAL_MESSAGE;
  try {
    return lastAnswer(await readTail(transcriptPath)) ?? NO_FINAL_MESSAGE;
  } catch {
    return NO_FINAL_MESSAGE;
  }
}

/** The adapter's enrich: adds lastAssistantMessage to a normal Stop body. */
export function createAntigravityEnrich(
  home: string,
): (raw: Record<string, unknown>) => Promise<Record<string, unknown>> {
  return async (raw) => {
    if (!isNormalStop(raw)) return raw;
    return {
      ...raw,
      lastAssistantMessage: await finalMessage(home, raw.transcriptPath),
    };
  };
}
