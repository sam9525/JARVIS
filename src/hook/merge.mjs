// Shared by install.mjs (manual CLI) and src/main/hook-install.ts (auto-install
// before first terminal launch). Pure: takes parsed settings, returns merged.
// Pre at "*" does ship every Write's content and every Task's prompt; that
// cost is accepted because the call line needs Bash and Task, and the
// listener is localhost-only. Post stays narrow because its payloads are
// AskUserQuestion is the one exception to the narrowness above: its response
// is the selection the user made, a handful of strings, not tool output.
const POST_MATCHER = "Read|Grep|Glob|Edit|Write|AskUserQuestion";
const PRE_MATCHER = "*";
const EVENTS = [
  "PreToolUse",
  "PostToolUse",
  "UserPromptSubmit",
  "Notification",
  "Stop",
];

// Any entry already pointing at forward.mjs is ours (possibly stale from an
// older checkout path or matcher).
const referencesForward = (h) =>
  Array.isArray(h?.hooks) &&
  h.hooks.some(
    (sh) =>
      typeof sh?.command === "string" && sh.command.includes("forward.mjs"),
  );

function withoutOurHooks(settings) {
  const out = { ...settings, hooks: { ...(settings.hooks ?? {}) } };
  for (const event of EVENTS) {
    const list = Array.isArray(out.hooks[event]) ? out.hooks[event] : [];
    out.hooks[event] = list.filter((h) => !referencesForward(h));
  }
  return out;
}

export function mergeHooks(settings, command) {
  const hooks = [{ type: "command", command }];
  // Stop and Notification take no matcher — they always fire
  const entries = {
    PreToolUse: { matcher: PRE_MATCHER, hooks },
    PostToolUse: { matcher: POST_MATCHER, hooks },
    UserPromptSubmit: { hooks },
    Notification: { hooks },
    Stop: { hooks },
  };
  const out = withoutOurHooks(settings);
  for (const [event, entry] of Object.entries(entries)) {
    out.hooks[event] = [...out.hooks[event], entry];
  }
  return out;
}

// v1 installed into the shared, version-controlled settings.json; v2 writes
// settings.local.json. Leaving the old entry in place forwards every event
// twice. Returns null when the file holds nothing of ours — the caller must
// then not rewrite it, so foreign repos' tracked config stays byte-identical.
export function stripHooks(settings) {
  const hooks = settings.hooks ?? {};
  const ours = EVENTS.some(
    (e) => Array.isArray(hooks[e]) && hooks[e].some(referencesForward),
  );
  if (!ours) return null;
  const out = withoutOurHooks(settings);
  for (const e of EVENTS) if (out.hooks[e].length === 0) delete out.hooks[e];
  return out;
}
