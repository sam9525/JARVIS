# Project Guide - Vault X-Ray (JARVIS)

Electron desktop app — a cockpit for N workspaces (vault + indexed repos), each with its own force-graph and embedded Claude Code terminal (PTY). Live-highlights nodes as Claude Code reads/searches files via hooks. Feature overview, MCP tools, gestures and configuration are in `README.md`; GitNexus rules are in `AGENTS.md`.

## Commands

- Dev: `npm start` (Electron Forge dev)
- Build/Package: `npm run make`
- Voice assets: `npm run voice:assets` — fetches the whisper model, the ONNX WASM runtime and `face_landmarker.task` into the gitignored `public/voice/`. Voice fails to start on a fresh clone until this runs, and the mouth-detection tier is silently unavailable.
- Test: `npm test` (vitest). Fixtures: `tests/fixtures/{vault,hook,gitnexus,graphify}/`.
- Lint/Format: `npx eslint . --fix` / `npx prettier --write .`

## Architecture & Core Decisions

- **Passive observer that owns the Claude Code sessions.** The app writes no AI/search logic. It reacts to hook events POSTed by `src/hook/forward.mjs` to a localhost listener on port 4599, and runs one `claude` CLI per workspace in a PTY (node-pty + xterm.js). Hooks registered in `src/hook/merge.mjs`: `PreToolUse` (matcher `*`), `PostToolUse` (matcher `Read|Grep|Glob|Edit|Write` — kept narrow on purpose, since a wider matcher would ship every Bash command's full output), `UserPromptSubmit`, `Notification`, `Stop`.
- **Two independent mappers read the same payload.** `event-mapper.ts` decides which nodes light up; `status-mapper.ts` decides what the workspace is doing. `http-listener.ts` gives each its own `try`.
- **`tool_response` is read for one thing only:** the files a `PostToolUse` Grep/Glob matched (`response-paths.ts` `extractPaths`). Every other reaction comes from `tool_input`.
- **Status lives in main** (`workspace-status.ts`), the only process that sees both hooks and PTY lifecycle. `Notification`'s `notification_type` separates `permission_prompt` (waiting on you) from `idle_prompt`. `Stop` does not fire on an Esc interrupt: a 60s staleness rule demotes Running to Idle, and must never promote to Waiting.
- **Graph sources are a registry** (`src/main/graph-sources/`): ordered `vault`, `gitnexus`, `graphify`. `resolveSourceId(ws)` picks the first whose `detect()` passes and is re-probed on rescan, not only at boot. A source pairs `stale?()` with `reindexCommand?`, and `loadSymbols?()` is optional (absent means an empty symbol graph). `graphify` is last so a repo with both resolves to gitnexus, and it is read-only: JARVIS never runs `/graphify`. `canIndex()` offers indexing only to gitnexus and bare folders. Adding a provider is one file plus a `SOURCES` entry. Source captions live only in `SOURCE_LABELS`.
- **The graph is static; AI activity is a highlight layer.** Never build the graph from search results. Vault: wikilinks, md links and tags. Code: gitnexus File nodes + IMPORTS edges.
- **Node identity:** vault ids are vault-relative POSIX paths without `.md` (`relative(cwd, path)` → `\` to `/` → strip `.md`). Code ids keep the extension so they match gitnexus `filePath`. Paths outside cwd or non-`.md` files in a vault are ignored. Unresolved `[[links]]` create no node.
- **Highlight lifecycle:** search pulse ~600 ms; matched files ~3 s; Read is a persistent ring plus a read-order trail; modified stays for the session. Everything resets on a new session **or a new prompt**.
- **Session replay is in-memory and renderer-side** (`session/replay.ts`). `foldTo` replays the same `applyEvent` with each event's index as its clock, so replay cannot drift from live. A folded state carries `frozenAt` to hold transients still. A new session wipes the log.
- **Naming:** `Workspace → Session → Event`, never `vault`. `ToolEvent.nodeIds` stays an array.
- **No database.** Persistence is JSON in `userData`: `jarvis-settings.json` (also panel geometry, `panelViewport`, `mainColors`, `recentHues`), `jarvis-vault`, `jarvis-inbox.json` (last messages; restored rows read `idle`), and `jarvis-briefing.json` (kept separate because the renderer overwrites the settings file). The event log is never persisted.

### Orchestrator / main agent

- **`isSelf` is a synthetic workspace** at `<userData>/main-agent`, appended by `withMainAgent`. The flag drives `.mcp.json`, the home terminal pin, self-send refusal, the `publishFinish` skip and the spoken voice. It is filtered out of the rail, cards and ring. It is the only PTY launched automatically (`--model sonnet`, plus `--continue` when a transcript `.jsonl` exists).
- **MCP:** `mcp-install.ts` writes `.mcp.json` into the `isSelf` workspace only, and `ensureMcp` strips the `jarvis` server from every other workspace. Delegates must never get the tools: a second `jarvis_watch` holder would overwrite the single waiter slot. `src/hook/mcp.mjs` (stdio JSON-RPC, no SDK) proxies to `/orchestrate/*` → `orchestrate.ts`.
- **Security:** `/orchestrate/*` requires the `x-jarvis: 1` header, and preflights are never answered. `/event` stays open but requires `application/json`, caps bodies at 1 MiB, and returns 404 for every non-POST.
- **Two-write submit — don't merge them.** `jarvis_send` and `publishFinish` write the prompt, then `"\r"` as a separate write 80 ms later; a CR in the same chunk lands as a newline in the composer. `ptyManager.write` reports whether a PTY existed.
- **Launch waits for quiet.** `jarvis_launch` and the boot briefing wait for `SETTLE_MS` of PTY silence (`settle.ts`, capped by a deadline), because text written before raw mode is dropped. For an untrusted folder, `launch` answers `trustPrompt` (read from `~/.claude.json` via `folder-trust.ts`); `jarvis_trust` types the user's answer only while the config still says untrusted.
- **A finish wakes the agent exactly once:** a parked `jarvis_watch` waiter is resolved, otherwise `publishFinish` types `FINISH_NUDGE`.
- **Daily briefing** gate: `notesDir !== null && resume && lastBriefed !== todayLocal() && hour >= 7`. The nudge delegates the note path to the vault workspace (the non-`isSelf` one with `kind === "vault"`, never matched by name). The app reads no note itself.
- **To-dos:** `TODO.md` in the main-agent folder, one task per line: `- [ ] text @project YYYY-MM-DD`. The panel never writes the whole list; `todo-op` sends one op naming `line` + `raw`, and the store refuses a changed line as `stale`. Only `ENOENT` reads as empty. The main-agent `CLAUDE.md` is written once (`wx`), so rules for an existing install live in tool descriptions.
- **The app composes no prompt text**, with two bounded exceptions: the one-time `AGENT_GUIDE` file and the fixed `FINISH_NUDGE` line (which names no workspace and quotes no message). Also out of scope: editing notes from the app, persisting events, non-Claude backends, and parsing terminal output (`jarvis_list` is built from hooks). The inbox is read-only.

### Renderer traps

- **Fleet view:** node ids are prefixed `<wsId>::`, which breaks the highlight store's keys, so Fleet shows no highlights. Making it live needs a prefix-aware `hlKey`.
- **Ring view:** the centre graph loads only after rotation rests about 300 ms, so spinning starts one simulation, not eight. Cards stay the default landing view.
- **Mission-control cards** re-settle on each visit on purpose. Keeping them mounted would hold N simulations alive.
- **Never put per-frame values in React state.** A re-render restarts the force simulation underneath. Hand cursor, voice wave and head are written through refs or imperative handles.
- **Hands:** each view registers actions via `useHandActions` during render, with identity-guarded cleanup. Distances are strictly 2D (MediaPipe `z` is unreliable). Two palms is a mode: while both are up, the one-hand gestures stand down. `armed` is session-only, and disarmed must look different from camera-off.
- **Layers:** graph z0, bezel z10, scanlines z15 (below panels on purpose), `footLeft` z16, panels in the 20–40 band, sweep z48. The bezel and `footLeft` are pointer-transparent; only the scrubber opts back in.
- **Panels (`ui/panel-layout.ts`, pure):** `raise` renormalises the whole map, so persist all of its output (writing back one panel causes a z tie, and `raise` then short-circuits forever). `resizePanel` clamps the west/north delta before the rect. `rescaleAll` scales against `panelViewport`, which keeps it idempotent and StrictMode-safe. Focus binds on the capture phase. Exit completion is a timer, not `animationend`. A Panel closed via `open === false` must stay mounted to play its exit, and `closing` must be cleared after `onClose`. The fold class is armed during render, not in an effect.
- **Boot sequence (`ui/boot-stage.ts`):** one stage per tick; `FALLBACK_MS` is `Math.max`'d with the hold. Hidden sections use `visibility: hidden` (`boot-hold`), so `TerminalPanel` focuses on its `visible` prop rather than at mount. Reduced motion skips the sequence entirely. Duration constants have twins in `index.css`, enforced by `tests/ui/animation-durations.test.ts`.
- **Colours:** hues are drawn at random (`pickHue`/`pickHues`, rejecting anything within 25° of the last 10 picks), with `nextHue()` as the always-terminating fallback. Reserved bands are cyan 172–202 (read/hover/accent) and amber 10–40 (modified); a plain node never wears them. Return `#rrggbb`, never `hsl()`, or `brighten` silently stops working. The workspace fallback hue is keyed on **name** so home and Fleet agree. Groups are per workspace and seeded in the renderer: "seeded" means `id in groups`, and the seeding effect writes only when something changed, which keeps it from looping. Folders of 5 notes or fewer get no group.
- **One segmented control:** `ui/Segmented.tsx`. Don't add one-off toggles.

### Voice

- **Only the `isSelf` session is listened to or spoken for.** Whisper is imported dynamically and runs only on energy-gated segments. Dictation opens at the wake word and closes 2500 ms after the _last_ utterance.
- **Voice never writes `"\r"`.** A human always presses Enter.
- **The ear goes deaf while the mouth talks:** transcripts arriving while `isSpeaking()` is true are dropped. That check reads `ended`/`paused`, so an utterance whose `onended` never fires can't deafen the mic for good.
- **Mouths, in order:** ElevenLabs (`tts.ts`, in main so the key never enters the window), then Edge TTS (`edge-tts.ts`; an undocumented endpoint, so don't ship JARVIS to others), then `speechSynthesis`.
- **Don't silence the voice when wiring the analyser.** A `MediaElementSource` must connect to `destination` on creation, and a context that isn't `running` is left unwired. On the `speechSynthesis` floor the wave is flat by necessity.
- **Head:** a GLB rendered as a back-face-culled wireframe in one `Path2D`/`stroke()`. Its maths lives in `head-mesh.ts`, which imports no three so it stays unit-testable. `buildModel` negates y, so it must also swap triangle winding, or the cull keeps the wrong half. The stroke is capped at `MAX_WIRE_FACES` by striding through the faces. Mouth movement comes from `head-rig.ts`, which tries five tiers in order: manual, morph, bone, detected, none. The built-in helmet has none, so it only turns and lights. Read `isSounding()`, not `isSpeaking()`, for motion. Uploaded heads are reached by name only (`safeName`), never overwritten in place, and capped at 256 MB. `mountColourHead` owns its canvas because `forceContextLoss` kills a reused one.
- Whisper/ONNX, hand models and the head GLB are served from `public/` because the CSP (`default-src 'self'`) forbids CDN fetches.

## Special Instructions / Tooling Guardrails

- The hook forwarder and MCP server are plain `.mjs`, not TypeScript, because Claude Code spawns them directly.
- Windows is the primary target and macOS is also supported (`MakerZIP` for darwin; `scripts/fix-pty-perms.mjs` restores node-pty's spawn-helper execute bit). Hook paths may arrive as Windows absolute paths, so always normalise `\` to `/`.
- Hook config is installed into the **workspace's** `.claude/settings.local.json` (`hook-install.ts`; CLI: `src/hook/install.mjs`), and v1 hooks in the shared `settings.json` are stripped. The app tree has no hook-settings folder.
- UI stack: react-force-graph-2d/3d + three, Tailwind v4, chokidar, and `marked` via the `renderNote` pipeline. Note HTML is unsanitized and backstopped by the CSP in `index.html`.
- gitnexus graphs come from shelling out to `gitnexus cypher` (an informal 1.6.x contract pinned by fixtures). graphify graphs come from `graphify-out/graph.json` (networkx node_link_data, also pinned by fixtures).
- **Packaging:** `src/hook` ships as an `extraResource` and is resolved via `process.resourcesPath` when packaged. `packagerConfig.ignore` copies `node_modules/node-pty` whole (minus `.pdb` files), and `asar.unpack` frees it from the archive. `rebuildConfig` rebuilds nothing on purpose, because the N-API prebuilds work.

## Layout

```
src/main/      Electron main: listener, mappers, status, graph-sources/, pty, orchestrate, main-agent, todos, tts
src/renderer/  App.tsx + feature folders: graph/ hands/ voice/ home/ preview/ terminal/ todos/ session/ ui/
src/shared/    types.ts, wikilink.ts
src/hook/      forward.mjs, install.mjs, merge.mjs, mcp.mjs
tests/         vitest, mirroring src folders + fixtures/
```

<!-- gitnexus:start -->

# GitNexus — Code Intelligence

This project is indexed by GitNexus as **JARVIS** (4941 symbols, 11037 relationships, 300 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> Index stale? Run `node .gitnexus/run.cjs analyze` from the project root — it auto-selects an available runner. No `.gitnexus/run.cjs` yet? `npx gitnexus analyze` (npm 11 crash → `npm i -g gitnexus`; #1939).

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows. For regression review, compare against the default branch: `detect_changes({scope: "compare", base_ref: "main"})`.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `query({search_query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `context({name: "symbolName"})`.
- For security review, `explain({target: "fileOrSymbol"})` lists taint findings (source→sink flows; needs `analyze --pdg`).

## Never Do

- NEVER edit a function, class, or method without first running `impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `rename` which understands the call graph.
- NEVER commit changes without running `detect_changes()` to check affected scope.

## Resources

| Resource                                | Use for                                  |
| --------------------------------------- | ---------------------------------------- |
| `gitnexus://repo/JARVIS/context`        | Codebase overview, check index freshness |
| `gitnexus://repo/JARVIS/clusters`       | All functional areas                     |
| `gitnexus://repo/JARVIS/processes`      | All execution flows                      |
| `gitnexus://repo/JARVIS/process/{name}` | Step-by-step execution trace             |

## CLI

| Task                                         | Read this skill file                                        |
| -------------------------------------------- | ----------------------------------------------------------- |
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md`       |
| Blast radius / "What breaks if I change X?"  | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?"             | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md`       |
| Rename / extract / split / refactor          | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md`     |
| Tools, resources, schema reference           | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md`           |
| Index, status, clean, wiki CLI commands      | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md`             |

<!-- gitnexus:end -->
