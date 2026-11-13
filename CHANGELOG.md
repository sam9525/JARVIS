# Changelog

All notable changes to JARVIS are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.5.5] - 2026-11-13

### Added

- Plain-text questions from the agent are now detected, shown in the question panel with their options, and answered from there. A reply is sent once, and you are told why one was refused.
- An auto-answer button for the agent's multiple-choice questions, with titled controls. A question it answered stays in the panel until you dismiss it.
- Skills and custom commands appear in the composer's slash list when the draft starts with a slash. Built-in commands, recalled drafts and long descriptions still work there.
- A finish marker on the mission-control card, and cards and status surfaces show when a turn ended on a question or an error. The main agent is told how each turn ended, and a turn waiting on background work is not counted as finished.
- A to-do shortcut that opens and closes the list, and a terminal toggle key that folds the terminal when you enter a project. Both keys can be changed in settings, and risky keys are refused.

### Changed

- The main agent resumes a closed session for the same work instead of starting a new one. Delegate sessions it launched close after 30 minutes of silence, a batch that splits opens one tab per spec, and the finish nudge names the workspace and tab.
- The main 3D graph draws its links as one merged layer and is capped at 60 frames a second, so it uses less of the machine. A new load sampler command line tool records how heavy the app is.

### Fixed

- Long and multi-line prompts sent by the agent arrive as one block, and removing a worktree no longer leaves its links behind.
- The question panel no longer opens for code, quotes or a question heading over a list. It now opens for a question followed by a short note, options split by blank lines, and a closing line that asks you to choose. An old question closes when the agent's next turn ends on a statement.

## [0.5.4] - 2026-11-05

### Added

- A session screen that replaces the raw terminal: a streamed transcript with cards, a status line, a composer with pickers and pasted images, and Up and Down to recall earlier prompts.
- Several sessions per project, each in its own terminal tab with a topic name, its own git worktree, and its own questions and highlights. The main agent can launch, close, resume and address them by tab.
- Previews of the spec or plan a question is about, opened from the question panel and closed when you approve.
- A "working" mark in the to-do list, and one batch prompt per project.

### Changed

- Idle home cards show a cached graph picture so they appear at once, and each card shows its session's current step and pipeline stage.
- A tab holding unmerged work, unsent text or a draft stays open and offers "Close anyway"; a tab whose work is merged closes itself. A crashed session keeps its tab until you close it.
- The main agent's guide is rewritten when its source changes, the finish nudge is shorter, and long spoken lines are split into parts so the Edge voice no longer fails on them.

### Fixed

- Nothing the agent sends, nudges or briefs, and nothing sent from the session screen, is typed in while a prompt or question is open. A prompt's status clears once it is answered, and a question disappears when its session ends. Launched sessions get the stored Windows PATH.

## [0.5.3] - 2026-10-22

### Added

- The code preview shows line numbers and git change markers, refreshes when Claude edits the open file, and opens a markdown note as colored source with line numbers.
- The graph fits to the screen after a filter change, and a node's label turns amber while it wears the modified ring.
- Reopening the app within an hour resumes each project's session.
- A to-do is checked off when a workspace reports its work merged into develop.
- The daily briefing pulls the notes vault first and reads the latest date's note from every machine.

### Changed

- A project's main color is redrawn when it looks too much like another project's, and group colors stay visibly distinct.

### Fixed

- A failed code graph load now shows why and is never cached, and the index button no longer appears for an empty graphify graph.
- The main agent's input is cleared before a nudge is typed, and node-pty's spawn helper regains its execute permission on install.

## [0.5.2] - 2026-10-02

### Added

- A launched session asks you before its folder-trust prompt is answered, and the main agent gets a `jarvis_launch` tool.
- The daily briefing is delegated to the vault workspace.
- Double-clicking a to-do opens it in a view panel, and the to-do composer, panels and `@project` completion are shared across screens.
- The ring view reopens on the last centered workspace, the 3D graph draws the search pulse ring, and mission-control cards are bordered by status, blue while working.
- A new arc reactor app icon, a README, and an MIT license.

### Changed

- Modified nodes are drawn as a ring beside the read ring instead of being recolored.
- A packaged macOS build gets its shell PATH and media permissions.

### Fixed

- Each paragraph's lead sentence is spoken as the summary, and a launched session is waited on until it settles.

## [0.5.1] - 2026-09-28

### Added

- A to-do list: a panel grouped by project with colored headers, a split composer to add tasks, and a toggle button, centered at half height and growing with the list.
- A `jarvis_todos` tool so the main agent can read and edit the list.
- The daily briefing opens with a short spoken summary.

### Fixed

- Refused to-do edits are reported and unreadable task text is guarded against.
- The to-do panel can shrink when you drag its edge.

## [0.5.0] - 2026-09-26

### Added

- A daily briefing: on the first launch of a day the main agent resumes its session and is nudged to brief you from your notes, with the notes folder picked in settings.
- An Edge read-aloud voice as a fallback when ElevenLabs gives no audio.
- Only the first paragraph of a long message is spoken.

### Fixed

- The main agent's transcript is found on any path and the session is resumed on relaunch.
- Each turn's reply is spoken even when its text repeats.
- The Edge voice works in a packaged build.

## [0.4.4] - 2026-09-11

_The installers for this release are still labeled 0.4.3._

### Added

- Claude's question appears in a centered panel you can answer without opening the terminal.
- Running `gitnexus impact` lights the blast radius on the graph, with hop counts, not just the file.
- A boot sequence: the cockpit opens in reading order, with the rail opening first workspace to last.
- Six status kinds, with asking split out of working, and a crashed session reads as crashed. They show on the rail, the cards and the inbox.

### Fixed

- Hooks, the MCP server and node-pty are included in a packaged build, so the main agent runs there too.
- One answer is taken at a time, and a question clears for the workspace it names.
- A markdown preview shows as a note in a code workspace, not as source.

## [0.4.3] - 2026-09-01

### Added

- Pick the head's mouth by hand when the model has no rig, or let the app find it by detecting the face in a render of the head.
- The head renders with the model's own materials and its mouth moves with the voice, in both render modes.
- The main agent's inbox summary is shown in full.

### Changed

- Whisper runs in its own worker, which keeps voice recognition from stalling the window.
- The mouth opens by how loud the voice is rather than how sharp, and costs nothing per frame when off.
- The settings column stays 250px wide however large the window is.

### Fixed

- The colour head is drawn upright, lit and aimed the right way, and can be switched on and off repeatedly.

## [0.4.2] - 2026-08-29

### Added

- The main agent's voice is drawn as a head over a waveform bar equalizer that rests as dots. The head is built from a real mesh, and you can upload your own model from settings.
- Each project gets one hue, and group colors are drawn at random with recent picks kept apart.

### Changed

- The main agent is asked for the fewest words in its summaries.
- The head is drawn only when the voice is on, and three is loaded with it.

### Fixed

- A project has the same color in Fleet and at home, and hues are spread over the free color wheel so two domains cannot share one.
- Only the workspace that just finished is summarised.

## [0.4.1] - 2026-08-26

### Added

- A dedicated main agent that launches at boot on Sonnet, with its own folder and standing instruction. It stays out of the graph views and out of packaged builds.
- Delegate finishes are queued and announced, the agent's summary is spoken, and `jarvis_watch` and `jarvis_say` are exposed as tools.
- Speech through ElevenLabs with a fallback to the system voice, configured in settings with an encrypted key.
- Choose the microphone voice listens on, and the Claude model on the terminal launch overlay.

### Changed

- The spoken summary is held to one sentence, and the app stays deaf for a moment after the mouth closes.
- The terminal folds at launch and settings stay pinned on top.

### Fixed

- Only the main agent's workspace gets the jarvis MCP server; it is stripped from the rest.
- The live flag is based on the app's own terminal process, and home counts only the workspaces it renders.

## [0.4.0] - 2026-08-23

### Added

- Voice control for the orchestrator's session: local whisper transcribes microphone speech, a "jarvis" wake word opens a dictation, and a multi-breath command is typed into the session.
- The orchestrator's status message is read aloud.
- A voice toggle button and a voice control setting that is remembered.

### Fixed

- Voice no longer drops commands, speaks stale or self-triggering messages, or misreports the microphone.
- What was said is transcribed correctly, with embedded whitespace collapsed.

## [0.3.6] - 2026-08-13

### Added

- A HUD look: design tokens, a bezel and a scanline overlay.
- Terminal, preview and settings become floating panels that you drag, resize from any edge, minimize to their title bar, and whose positions are remembered.
- The window and every panel scale to the display.
- Hand control can pinch to grab a panel under the hand cursor.
- Subtle idle motion on the HUD, with a reduced-motion fallback.

### Changed

- Closing a workspace terminal closes it instead of folding it to a stub, and home's terminal collapses to an inbox strip.

### Fixed

- Panel stacking, dragging and window resizes no longer restart the graph simulation, and panels stay clear of the header.
- A foreign session no longer blanks a workspace's inbox message.

## [0.3.5] - 2026-08-08

### Added

- Inbox rows expire after 6 hours idle with no live terminal.
- Mission-control card graphs load in parallel.

### Changed

- Ring tiles animate smoothly, and the ring's centre graph waits for the entrance to finish and honours the view filters.

### Fixed

- The ring and fleet refresh storm is gone, and ring rotation no longer rebuilds the centre graph.
- Mission-control cards repaint their highlights, and 3D nodes no longer rebuild on each update.
- A disarmed hand toggle no longer reads as camera-off, and home views keep their gesture map.

## [0.3.4] - 2026-08-05

### Added

- Hand control for the graph: a webcam hand toggle, a fist to disarm and a held palm to arm, a pinch to drag, a two-finger tap to open, and palm roll to orbit.
- Hand control on the 2D, 3D and fleet graphs, and two palms spreading to zoom.
- A setting to turn hand control on, off by default.

### Fixed

- Swipe is fingertip speed at any frame rate, and palm posture survives tracker noise.
- Two-palm mode hands back the one-hand state it froze, and an abandoned bend expires.
- Refresh re-fits and re-centres the ring.

## [0.3.3] - 2026-07-30

_No git tag; dated by its version bump commit._

### Added

- The groundwork for hand control: a webcam hand-landmark tracker over local MediaPipe, a gesture engine, and smoothing filters.
- A ring-view hand toggle that rotates, snaps, steps and opens tiles.

### Changed

- The content security policy allows WASM compilation for hand tracking.

## [0.3.2] - 2026-07-30

### Added

- A ring view, the third home view: tiles rotate around a centre graph that loads once the rotation rests.
- Tiles fly out from the hub when the ring opens, and the centred tile swells as it reaches the front.

### Fixed

- Tile clicks land and the rotation animates to the centred tile.
- Refresh picks up a graph source added after launch, the reindex button names the right tool for each source, a graphify workspace is not offered indexing, and the mouse wheel rotates the ring instead of the 3D camera.

## [0.3.1] - 2026-07-29

_No git tag; dated by its version bump commit._

### Added

- Graphify as the third graph source: a project with a `graphify-out/graph.json` shows file and symbol graphs.

### Changed

- Symbol graphs are loaded through the source registry rather than gitnexus directly.

## [0.3.0] - 2026-07-28

_No git tag; dated by its version bump commit._

### Added

- A graph-source registry (vault and gitnexus), so each workspace resolves its own source and the rail groups workspaces by it.

### Changed

- The renderer no longer routes by workspace kind: one active-graph load path serves every source.

### Fixed

- The full call is readable through a tooltip on mission-control cards.

## [0.2.4] - 2026-07-28

### Added

- An orchestrator: the vault workspace gets an MCP server with `jarvis_list` and `jarvis_send`, so one agent can see and message the others. Inbox and cards show who delegated a session.
- A command center that opens by default, with a Cards or Fleet toggle; Fleet merges every workspace graph into one map, in 2D or 3D, with a refresh button.
- A per-workspace terminal and inbox detail panel, with the last inbox message kept across a restart.
- Per-workspace graph groups and a halo opacity slider.
- The call line names the running skill.

### Changed

- The home terminal is pinned to the cockpit's own repo, and the reply box is gone from the terminal panel.
- The Fleet 3D graph is lighter, with a single blue backdrop.

### Fixed

- The listener is hardened, undelivered orchestrator writes are reported, and prompts are submitted as a separate carriage return.

## [0.2.3] - 2026-07-23

### Added

- An inbox of live sessions with a message detail panel and a reply box that sends your reply into the session.
- The last message of a session is kept in the workspace status.
- A code-only symbol graph level, with a toggle, loaded from gitnexus; highlights resolve to the symbol's file.

### Fixed

- The symbol graph refreshes correctly and shows search match rings.

## [0.2.2] - 2026-07-23

### Added

- Add a project from the workspace rail, and index it from a mission-control card that has no graph.
- A session replay bar: scrub back through a session's events and chapters.
- Hot nodes grow and brighten with deliberate touches, in 2D and 3D.

### Fixed

- Projects with no git history or gitnexus index can be indexed, and a hung gitnexus analyze times out.
- Match rings last as long in 3D as in 2D, and a card's Enter no longer steals the index button's.

## [0.2.1] - 2026-07-22

### Added

- A mission-control home screen: a card grid with a frozen graph thumbnail and a live highlight layer, and a status badge on each rail button.
- Per-workspace status computed in the main process: running, waiting, idle.
- Matched files from Grep and Glob glow in 2D and 3D.
- A dangerous-mode launch button that skips Claude's permission prompts.

### Changed

- The dangerous-mode launch needs a second click, and thumbnail canvases are parked to stay cheap.

### Fixed

- The terminal tab stays off the mission-control screen, and the path list pulled from a tool response is capped.

## [0.2.0] - 2026-07-22

_The merge commit this tag points at says "for v0.3.0" by mistake._

### Added

- A workspace rail: each workspace has its own graph, highlights, preview and docked terminal running Claude in its own process.
- Workspaces come from your vault and the gitnexus registry, and code graphs load from gitnexus.
- Code previews are syntax-highlighted.
- Hook events are routed to the right workspace by folder.

### Changed

- The cockpit layout is responsive, and the terminal panel starts collapsed.
- Hooks are installed into `settings.local.json` instead of the shared settings.

### Fixed

- The terminal refits on window resize, and a failure to load node-pty no longer blocks startup.
- The gitnexus repo name is validated before it is used in a shell command.

## [0.1.1] - 2026-07-22

### Added

- A note preview that renders markdown with Obsidian callouts, inline embeds, and clickable wikilinks and external links.
- Read nodes become a persistent ring with a numbered trail of read-order arrows in 2D and 3D.
- The last-read note opens in a docked preview, and the graph zooms to it. A focus-zoom setting sets how far.
- Refresh the graph from the HUD button or F5.

### Changed

- A hologram look in Tailwind for the graph canvas, HUD, settings and preview, and the menu bar is removed.

### Fixed

- A security policy blocks note content from leaking out, and window navigation is guarded.
- A new prompt closes the preview and resets highlights, and a failed rescan no longer breaks the cached graph.

## [0.1.0] - 2026-07-13

### Added

- The first release: a live graph of your vault that lights up as Claude Code reads, searches and edits notes, driven by hooks.
- Notes appear as nodes linked by wikilinks, markdown links and tags, with a centered preview on a read.
- A hook installer, and a localhost listener that receives the hook events.
- Graph settings: filters, groups with colors, display and force sliders, and your chosen vault folder is remembered.
- A 2D and a 3D graph view, with labels, hover highlights, glow, halos and idle rotation.
