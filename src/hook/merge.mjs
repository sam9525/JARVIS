// Shared by install.mjs (manual CLI) and src/main/hook-install.ts (auto-install
// before first terminal launch). Pure: takes parsed settings, returns merged.
const MATCHER = "Read|Grep|Glob|Edit|Write";
const EVENTS = ["PreToolUse", "PostToolUse", "UserPromptSubmit"];

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
  const hook = { matcher: MATCHER, hooks: [{ type: "command", command }] };
  // UserPromptSubmit resets highlights per question; prompt hooks take no matcher
  const entries = {
    PreToolUse: hook,
    PostToolUse: hook,
    UserPromptSubmit: { hooks: [{ type: "command", command }] },
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
