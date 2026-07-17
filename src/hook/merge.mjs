// Shared by install.mjs (manual CLI) and src/main/hook-install.ts (auto-install
// before first terminal launch). Pure: takes parsed settings, returns merged.
const MATCHER = "Read|Grep|Glob|Edit|Write";

export function mergeHooks(settings, command) {
  const hook = { matcher: MATCHER, hooks: [{ type: "command", command }] };
  // Any entry already pointing at forward.mjs is ours (possibly stale from an
  // older checkout path or matcher) — replace it with the canonical entry.
  const referencesForward = (h) =>
    Array.isArray(h?.hooks) &&
    h.hooks.some(
      (sh) =>
        typeof sh?.command === "string" && sh.command.includes("forward.mjs"),
    );
  // UserPromptSubmit resets highlights per question; prompt hooks take no matcher
  const entries = {
    PreToolUse: hook,
    PostToolUse: hook,
    UserPromptSubmit: { hooks: [{ type: "command", command }] },
  };
  const out = { ...settings, hooks: { ...(settings.hooks ?? {}) } };
  for (const [event, entry] of Object.entries(entries)) {
    const list = Array.isArray(out.hooks[event]) ? out.hooks[event] : [];
    out.hooks[event] = [...list.filter((h) => !referencesForward(h)), entry];
  }
  return out;
}
