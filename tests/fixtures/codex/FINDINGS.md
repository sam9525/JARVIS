# Codex hook findings

Recorded on 2026-11-15/16 with `codex-cli 0.167.0-alpha.3.2`
(`%LOCALAPPDATA%\OpenAI\Codex\bin\5449c1f0f26f1f98\codex.exe`, the only hash
folder present), Windows 11, model `gpt-6-astra`, in a scratch folder with a
`README.md` and a `greet.js`. The hook was `scripts/record-codex-hooks.mjs`.

Every `*.json` here is a real body as Codex sent it. Only two edits were made:
the scratch folder is replaced by `C:\work\demo`, and the home folder by
`C:\Users\user`. Codex sends Windows paths with `\` (JSON-escaped as `\\`) in
`cwd`, `transcript_path`, the `apply_patch` text and `tool_response`, so the
fixtures keep `\`.

## Command line that worked

Spawned directly with node-pty (no `cmd.exe`), working folder = the project,
one argv item per `-c` value, for each of `SessionStart`, `UserPromptSubmit`,
`PreToolUse`, `PostToolUse`, `PermissionRequest`, `Stop`, `Interrupt`:

```
codex.exe --dangerously-bypass-hook-trust
  -c hooks.SessionStart=[{matcher="*",hooks=[{type="command",command="node \"C:/.../recorder.mjs\" \"C:/.../out\""}]}]
  -c hooks.UserPromptSubmit=[...same...]
  ...
```

As Windows saw it (node-pty's quoting of one argv item):

```
-c "hooks.SessionStart=[{matcher=\"*\",hooks=[{type=\"command\",command=\"node \\\"C:/.../recorder.mjs\\\" \\\"C:/.../out\\\"\"}]}]"
```

Script paths use `/`. `--dangerously-bypass-hook-trust` was used for the
recording runs only, by the user's choice. Resume: the same flags, then
`resume <session_id> -a on-request` (see answer 10 and `PermissionRequest`).

Any `-c` makes Codex show a startup warning: "Running without the shared
background server: command-line configuration overrides (-c, --enable,
--disable, or --search) requires embedded mode."

## Answers

1. **Can `-c` set hooks? Yes.** All seven `-c hooks.<Event>=[...]` values were
   accepted and every event fired (all fixtures here).
2. **Does the `/hooks` approval hold on the next launch with the same `-c`
   text?** Not tested — the recording used `--dangerously-bypass-hook-trust` by
   the user's choice; deferred to the manual run. Observed without the flag (no
   approval given): at startup, before any prompt, Codex shows "Hooks need
   review / 7 hooks are new or changed. / Hooks can run outside the sandbox
   after you trust them." with "1. Review hooks / 2. Trust all and continue / 3. Continue without trusting (hooks won't run)". After option 3 and one
   prompt, no hook fired (no body recorded), and nothing hook-related was
   written to `~/.codex` (`hooks.json` absent, `config.toml` has no hook entry).
3. **Is `tool_input.command` a string or an array? A string.**
   `pre-bash-read.json`: `"command": "Get-Content README.md"`;
   `pre-bash-search.json`: `"command": "rg -n --hidden -g '!.git' 'greet' ."`.
4. **Is the command wrapped in a shell? No**, not in the payload. The string
   is the bare PowerShell text the model wrote, with no `powershell -Command`
   or `bash -lc` prefix. (Codex runs it through PowerShell itself: the error in
   `tool_response` points at "line 2", so it adds lines around it.)
   Shell `tool_input` has **no working-folder field**: `command` is its only
   key on `PreToolUse`/`PostToolUse`; `PermissionRequest` adds `description`.
5. **Does `Interrupt` fire on Esc? Yes.** `interrupt.json` (Esc during
   `Start-Sleep 30`). It carries `turn_id` and no tool fields; no `Stop` and
   no `PostToolUse` follow. Denying a permission prompt with Esc also fires
   `Interrupt` (and no `Stop`).
6. **Does the "clamping Interrupt hook timeout" warning show? No.** The warning
   panel (F2) listed only the two startup warnings ("Running without the shared
   background server..." and "`--dangerously-bypass-hook-trust` is enabled.
   Enabled hooks may run without review for this invocation."), and the raw
   terminal output of both runs has no "clamp" or "timeout" text.
7. **Is a plan-mode question hooked, and under which `tool_name`? Yes,
   `request_user_input`.** `pre-request-user-input.json` (`tool_input.questions[]`
   with `id`, `header`, `question`, `options[{label, description}]`) and
   `post-request-user-input.json` (`tool_response` is a JSON string:
   `{"answers":{"new_name":{"answers":["sayHello (Recommended)"]}}}`). No
   `PermissionRequest` fired for it. The "Implement this plan?" choice after
   the plan is not hooked; the `Stop` before it has
   `"last_assistant_message": null`. `permission_mode` stays `"default"` in
   plan mode.
8. **Does `SessionStart` fire before or after the folder trust question and the
   hook approval? After both: it fires lazily, when the first prompt is
   submitted, not at launch.** run1 launched at 23:57:29 (rollout file name);
   `SessionStart` was written at 23:58:18.65, 0.7 s after the first prompt's
   Enter (23:58:17.97) and 0.2 s before `UserPromptSubmit`. On resume,
   `source` is `"resume"` (`session-start-resume.json`), also at the first
   prompt. No folder trust question appeared for the scratch folder (a non-git
   folder under `%TEMP%`) in any run. Hook approval: not tested — the recording
   used `--dangerously-bypass-hook-trust` by the user's choice; deferred to the
   manual run (without the flag, the "Hooks need review" screen comes at
   startup, so before `SessionStart`).
9. **Is `session_id` a UUID? Yes, a UUIDv7**:
   `01a1df64-396f-7b43-ac5b-879d211c3ee2` (version nibble 7). `turn_id` is a
   UUIDv7 too. The rollout file name embeds it:
   `rollout-2026-11-15T23-57-29-<session_id>.jsonl`.
10. **Does `codex resume <id>` work, also for a compressed rollout? Yes for a
    plain `.jsonl` rollout; compressed not tested.** `codex resume
01a1df64-396f-7b43-ac5b-879d211c3ee2` restored the transcript (and plan
    mode), kept the same `session_id`, and its hooks fired. Codex prints
    "To continue this session, run: codex resume <id>" on exit. No compressed
    rollout of our own existed (Codex compresses after about a day); the one
    `.zst` on this machine is a real user session in a real project, so it was
    not resumed.

## Other facts for later tasks

- **Every payload** has `session_id`, `transcript_path`, `cwd`,
  `hook_event_name`, `model`, `permission_mode`; all but `SessionStart` add
  `turn_id`. `SessionStart` adds `source` (`"startup"` or `"resume"`).
- **`transcript_path` on resume has a `\\?\` prefix**
  (`session-start-resume.json`, and every later event of that run).
- **`tool_name` values seen:** `Bash` (shell), `apply_patch`,
  `mcp__node_repl__js` (a desktop-app MCP tool the model used to read and
  search after its shell commands failed; `pre-other.json`), and
  `request_user_input`. `PreToolUse` and `PostToolUse` carry `tool_use_id`
  (`exec-<uuid>` for shell, MCP and patch; `call_<hex>` for
  `request_user_input`). `PermissionRequest` has no `tool_use_id`.
- **`apply_patch` `tool_input`** is `{ "command": "<patch text>" }`; the patch
  text is `*** Begin Patch\n*** Update File: <absolute Windows path>\n@@\n-...\n+...\n*** End Patch`.
  `tool_response` is a string ending in
  `Success. Updated the following files:\nM <absolute path>\n`.
  A patch that failed to apply got a `PreToolUse` but no `PostToolUse`.
- **`PostToolUse` fires for `Bash` too**, with `tool_response` as a plain
  string (the command output); for MCP tools `tool_response` is an object
  (`{content:[{type,text}], isError, _meta}`).
- **`PermissionRequest`** (`permission-request.json`): `tool_name: "Bash"`,
  `tool_input: { command, description }`, where `description` is the reason
  shown in the prompt. It was reachable only with `-a on-request`; with the
  default permissions ("Workspace (granular)") the model said "this session's
  policy automatically rejects sandbox approval requests", and no prompt or
  `PermissionRequest` appeared.
- **`Stop`** has `stop_hook_active` and `last_assistant_message` (a string, or
  `null`).
- In this recording, sandboxed shell commands ran with `C:\` as their working
  folder (`Get-Content README.md` looked for `C:\README.md`), and `rg` was not
  on the sandbox PATH; the model then fell back to `mcp__node_repl__js`.
