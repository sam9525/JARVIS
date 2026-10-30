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
  Task: agentSubject,
  Agent: agentSubject,
  Skill: (i) =>
    typeof i.skill === "string"
      ? i.skill.slice(i.skill.lastIndexOf(":") + 1)
      : null,
};

// An MCP tool has no fixed schema, so show the first of these that holds a string.
const MCP_SUBJECT_KEYS = [
  "target",
  "name",
  "query",
  "search_query",
  "pattern",
  "url",
  "path",
];

function basename(v: unknown): string | null {
  if (typeof v !== "string" || !v) return null;
  const parts = v.split(/[\\/]/);
  return parts[parts.length - 1] || null;
}

function quoted(v: unknown): string | null {
  return typeof v === "string" && v ? `"${v}"` : null;
}

function agentSubject(i: Record<string, unknown>): string | null {
  if (typeof i.description === "string" && i.description) return i.description;
  return typeof i.subagent_type === "string" ? i.subagent_type : null;
}

function mcpSubject(i: Record<string, unknown>): string | null {
  for (const key of MCP_SUBJECT_KEYS) {
    const v = i[key];
    if (typeof v === "string" && v) return v;
  }
  return null;
}

// mcp__<server>__<rest> reads as "<server> <rest>"; odd shapes degrade to the
// text after the prefix, or the raw name when nothing follows it.
function displayName(toolName: string): string {
  if (!toolName.startsWith("mcp__")) return toolName;
  const body = toolName.slice(5);
  if (!body) return toolName;
  const sep = body.indexOf("__");
  return sep < 0 ? body : `${body.slice(0, sep)} ${body.slice(sep + 2)}`;
}

export function callSignature(
  toolName: string,
  input: Record<string, unknown>,
): string {
  const name = displayName(toolName);
  const pick = toolName.startsWith("mcp__") ? mcpSubject : SUBJECT[toolName];
  const subject = pick?.(input ?? {}) ?? null;
  const full = `${name}(${subject ?? "…"})`;
  if (full.length <= CALL_MAX) return full;
  // keep the tool name and the opening paren; the subject is what gets cut
  const room = CALL_MAX - name.length - 3; // "(", "…", ")"
  const cut = `${name}(${(subject ?? "").slice(0, Math.max(0, room))}…)`;
  // a tool name longer than the budget leaves nothing to trim — cut the label
  return cut.length <= CALL_MAX ? cut : `${cut.slice(0, CALL_MAX - 1)}…`;
}
