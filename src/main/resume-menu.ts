// Claude Code 2.1.x asks "This session is … old and … tokens." on a resume
// when the last message is at least 70 minutes old and the context holds at
// least 100k tokens. No hook or transcript line reports that menu, so the
// app reads the same two facts from the transcript it resumes.
// shortcut: Claude Code's flag-gated "Resume this conversation?" menu hangs on
// plan limits the app cannot see, so this misses it; a guess is the ceiling.
const MENU_AGE_MS = 70 * 60_000;
const MENU_TOKENS = 100_000;

interface Line {
  type?: string;
  timestamp?: string;
  message?: { usage?: Record<string, unknown> };
}

const contextTokens = (usage: Record<string, unknown>): number =>
  [
    "input_tokens",
    "cache_read_input_tokens",
    "cache_creation_input_tokens",
    "output_tokens",
  ].reduce((sum, k) => sum + (typeof usage[k] === "number" ? usage[k] : 0), 0);

export function resumeMenuLikely(jsonl: string, now: number): boolean {
  let lastAt = NaN;
  let tokens = 0;
  for (const raw of jsonl.split("\n")) {
    let line: Line;
    try {
      line = JSON.parse(raw) as Line;
    } catch {
      continue;
    }
    if (line?.type !== "user" && line?.type !== "assistant") continue;
    lastAt = Date.parse(line.timestamp ?? "");
    const usage = line.message?.usage;
    if (line.type === "assistant" && usage) tokens = contextTokens(usage);
  }
  return now - lastAt >= MENU_AGE_MS && tokens >= MENU_TOKENS;
}
