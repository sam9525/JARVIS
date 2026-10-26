const CALL_MAX = 30;

// Which single argument identifies each tool's call. Anything not listed shows
// the bare tool name — guessing an argument reads worse than admitting none.
const SUBJECT: Record<string, (i: Record<string, unknown>) => string | null> = {
  Read: (i) => basename(i.file_path),
  Edit: (i) => basename(i.file_path),
  Write: (i) => basename(i.file_path),
  NotebookEdit: (i) => basename(i.file_path),
  Grep: (i) => quoted(i.pattern),
  Glob: (i) => quoted(i.pattern),
  Bash: (i) => (typeof i.command === "string" ? i.command : null),
  Task: (i) => (typeof i.subagent_type === "string" ? i.subagent_type : null),
  Skill: (i) => (typeof i.skill === "string" ? i.skill : null),
};

function basename(v: unknown): string | null {
  if (typeof v !== "string" || !v) return null;
  const parts = v.split(/[\\/]/);
  return parts[parts.length - 1] || null;
}

function quoted(v: unknown): string | null {
  return typeof v === "string" && v ? `"${v}"` : null;
}

export function callSignature(
  toolName: string,
  input: Record<string, unknown>,
): string {
  const subject = SUBJECT[toolName]?.(input ?? {}) ?? null;
  const full = `${toolName}(${subject ?? "…"})`;
  if (full.length <= CALL_MAX) return full;
  // keep the tool name and the opening paren; the subject is what gets cut
  const room = CALL_MAX - toolName.length - 3; // "(", "…", ")"
  const cut = `${toolName}(${(subject ?? "").slice(0, Math.max(0, room))}…)`;
  // a tool name longer than the budget leaves nothing to trim — cut the label
  return cut.length <= CALL_MAX ? cut : `${cut.slice(0, CALL_MAX - 1)}…`;
}
