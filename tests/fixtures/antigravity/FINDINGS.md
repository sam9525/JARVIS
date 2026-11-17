# Antigravity hook findings

Recorded on 2026-11-16/17 with `agy 1.5.9` (`~/.gemini/bin/agy.exe`), Windows
11, model `gemini-4-argon-medium`, in a scratch git folder with a `README.md`
and a `greet.js`. The hook was `scripts/record-antigravity-hooks.mjs`,
registered in a separate hooks folder (`<hooks>/.agents/hooks.json`) and loaded
with `--add-dir <hooks>`.

Every `*.json` here is a real body as `agy` sent it, pretty-printed. Three
edits were made: the scratch folder is `C:\work\demo`, the hooks folder is
`C:\work\hooks`, and the home folder is `C:\Users\user`. `cwd` and
`toolCall.args.Path` use `\`; `workspacePaths`, `transcriptPath` and
`artifactDirectoryPath` use `/`.

## Command line that worked

Spawned directly with node-pty (no `cmd.exe`), working folder = the project:

```
agy.exe --add-dir <hooks folder> --settings {"notifications":true}
```

`--settings` takes the JSON as one argv item. Print mode adds
`-p "<prompt>" --output-format json`. Resume adds `--conversation=<id>`
(`--conversation <id>` as two items is the documented form; the `=` form is
what `agy` prints on exit and what was run).

## Tool map

| agy tool        | args key                                          | Claude tool              | event        | fixture                                    |
| --------------- | ------------------------------------------------- | ------------------------ | ------------ | ------------------------------------------ |
| `read_file`     | `Path` (absolute, `\`), `StartLine`               | `Read`                   | Pre and Post | `pre-read.json`, `post-read.json`          |
| `edit_file`     | `Path`, `Target`, `Replacement`                   | `Edit`                   | Post         | `pre-edit.json`, `post-edit.json`          |
| `write_file`    | `Path`, `Content`                                 | `Write`                  | Post         | `pre-new-file.json`, `post-new-file.json`  |
| `run_command`   | `CommandLine`, `WaitMsBeforeAsync`, `toolSummary` | shell parse, else `Bash` | Pre          | `pre-run-command.json` and the three below |
| `call_mcp_tool` | `ServerName`, `ToolName`, `Arguments`             | passes through           | Pre          | `pre-mcp.json`                             |

`agy` has **no search tool of its own**. On Windows it searches through
`run_command` with PowerShell:

| What it did      | `CommandLine`                                                         | fixture                 |
| ---------------- | --------------------------------------------------------------------- | ----------------------- |
| text search      | `Select-String -Path * -Pattern "greet"` (first try added `-Recurse`) | `pre-search-text.json`  |
| file-name search | `Get-ChildItem -Filter "*.js" -Recurse`                               | `pre-search-files.json` |
| folder listing   | `Get-ChildItem`                                                       | `pre-list-folder.json`  |

`parseShellCommand` (part 1) reads these as: `Select-String -Path * -Pattern
"greet"` → search `*` (wrong: it takes the first value, not `-Pattern`'s);
`Get-ChildItem -Filter "*.js" -Recurse` → search `*.js`; `Get-ChildItem` →
nothing; `Get-Content README.md` → read `README.md`.

A failed command (`node missing-file.js`) gives a `PostToolUse` with
`"error": ""` (`post-run-command-failed.json`): the field does not report a
non-zero exit.

## Stop bodies

Only one shape was seen, in every run that ended normally:
`terminationReason: "NO_TOOL_CALL"`, `error: ""`, `fullyIdle: true`,
`executionNum: 0`, `continuationActive: false` (`stop.json`). No
`USER_CANCELED`, no non-empty `error` and no `fullyIdle: false` occurred, so
there is no fixture for them.

In print mode, a tool that needs a permission headless mode cannot ask for (the
MCP call) is auto-denied and the run ends with **no** `Stop` hook.

## Esc

- Esc in the middle of a turn (TUI): **no `Stop` hook** and no further hook.
  The terminal gets `BEL` + `ESC ] 9 ; Antigravity CLI is ready for input BEL`
  about 60 ms after the key, then "Interrupted · What should Antigravity CLI do
  instead?".
- Esc at a permission prompt (TUI): "Interrupted", **no hook and no
  notification code**.

## --add-dir in the TUI

The hooks fire in the TUI exactly as in print mode. No trust question is shown
for the added folder. The added folder is the second entry of `workspacePaths`.
The hook process runs with `<hooks>\.agents` as its working directory and
inherits the PTY environment (`JARVIS_SESSION`).

## Resume

- `agy --conversation=<known id>`: the TUI opens with the old conversation on
  screen. No hook fires until the next prompt.
- `agy --conversation=<unknown UUID>`: the TUI opens as a **fresh session**. No
  error text, and the process does not exit. So a failed resume cannot be told
  from the exit code.
- On exit `agy` prints `Resume with -c (or command below):` and
  `agy --conversation=<id>`.

## Transcript at Stop

`transcript_full.jsonl` already holds the final answer when the `Stop` hook
runs: the last line is the `PLANNER_RESPONSE` with the answer as `content`
(`transcript-tail.jsonl`, the file's last four lines read inside the hook). No
retry was needed in three runs. A `PLANNER_RESPONSE` that only calls tools has
`tool_calls` and no `content`.

## Notification texts

With `--settings {"notifications":true}`:

| Text                                      | When                                                                                    |
| ----------------------------------------- | --------------------------------------------------------------------------------------- |
| `Antigravity CLI needs tool confirmation` | a permission prompt opens; also in `--mode plan` when a command needs approval          |
| `Antigravity CLI is ready for input`      | a turn ends (with the `Stop` hook), and after Esc in the middle of a turn (without one) |

Each is sent as `BEL`, then `ESC ] 9 ; <text> BEL`. A plan approval was not
reached in the plan-mode run (the turn stopped at a command approval first), so
its text is not recorded.

## Prompt keys

The permission prompt is a list:

```
> 1. Yes, run command
  2. No, cancel
↑/↓ Navigate · tab Amend · ctrl+g edit/expand command
```

No key was scripted into it except Esc. Which keys answer it (Enter on the
focused row, the digits) is to be confirmed by Sam.

## Desktop toast

Not observed from a scripted PTY. To be confirmed by Sam in the app.
