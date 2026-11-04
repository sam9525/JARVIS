import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  screen,
  shell,
} from "electron";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import started from "electron-squirrel-startup";
import { startListener, DEFAULT_PORT } from "./http-listener";
import { watchVault } from "./watcher";
import { loadSettings, saveSettings } from "./settings";
import {
  loadWorkspaces,
  normalizeId,
  nameFromRegistry,
  readProjects,
  saveProjects,
} from "./workspaces";
import { resolveSourceId, sourceById } from "./graph-sources/registry";
import { isDirectory } from "./is-directory";
import { runAnalyze } from "./graph-sources/gitnexus-source";
import { cachedGraph } from "./graph-cache";
import {
  deleteSnapshot,
  loadFingerprinted,
  readSnapshots,
  saveSnapshot,
} from "./card-snapshots";
import { ensureHooks } from "./hook-install";
import { ensureMcp } from "./mcp-install";
import { loginShellPath } from "./shell-path";
import { createOrchestrator } from "./orchestrate";
import { createPendingInput } from "./pending-input";
import { createSettle } from "./settle";
import { deliverBriefing } from "./brief-delivery";
import { isTrusted } from "./folder-trust";
import { createPtyManager, type SpawnFn } from "./pty-manager";
import { createTranscriptFeed, newestTranscript } from "./transcript-feed";
import { gitHead, toStatusLineView, userStatusLine } from "./status-line";
import { feedStatusEvent } from "./feed-follow";
import { listTranscripts } from "./transcript-list";
import { savePastedImage } from "./pasted-images";
import {
  BRIEF_AFTER_HOUR,
  FINISH_NUDGE,
  LAUNCH_SETTLE_DEADLINE_MS,
  MAIN_AGENT_MODEL,
  SETTLE_DEADLINE_MS,
  SETTLE_MS,
  typeNudge,
  dailyBriefNudge,
  ensureMainAgent,
  mainAgentWorkspace,
  withMainAgent,
} from "./main-agent";
import { createStatusStore, STALE_MS } from "./workspace-status";
import { ensureScratch, scratchWorkspace } from "./scratch";
import { createSessionRegistry } from "./sessions";
import {
  createWorktree,
  existingWorktreeFolders,
  isGitRepo,
  removeWorktreeIfDone,
  worktreeCheck,
  worktreeMerged,
  worktreePath,
} from "./worktrees";
import {
  MAIN_LABEL,
  MAX_SESSIONS,
  cleanLabel,
  nextLabel,
  parseSessionKey,
  sessionKey,
} from "../shared/session-key";
import { readAiTitle, topicWord } from "./transcript-title";
import { createTts } from "./tts";
import { MsEdgeTTS } from "msedge-tts";
import { createEdgeTts } from "./edge-tts";
import { appendCapped } from "./capped-log";
import { importHead, listHeads, readHead } from "./head-models";
import {
  hasTranscript,
  latestNotes,
  pullNotes,
  readBriefing,
  todayLocal,
  transcriptDir,
  writeBriefing,
} from "./briefing";
import {
  HEARTBEAT_MS,
  hasSessionTranscript,
  readSavedSessions,
  sessionsToResume,
  writeSavedSessions,
  type SavedSession,
} from "./session-restore";
import { watch, type FSWatcher } from "chokidar";
import type { AskPrompt } from "./ask-mapper";
import { createTodoStore, fileTodoIO, parseTodos } from "./todos";
import { lineChanges } from "./git-diff";
import type {
  CardLayout,
  LineChanges,
  Settings,
  StatusEvent,
  StatusLineView,
  TodoOp,
  VaultGraph,
  Workspace,
} from "../shared/types";

if (started) app.quit();

// Chromium blocks a page-initiated play() without user activation, and a
// spoken status arrives from a hook event — no gesture anywhere. Without this
// the cloud voice decodes fine and then silently loses to speechSynthesis.
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");

// The ElevenLabs key lives in .env at the project root, main-side only, so it
// never crosses the preload bridge. loadEnvFile throws when the file is absent;
// a missing key just means the local voice.
try {
  process.loadEnvFile(path.join(app.getAppPath(), ".env"));
} catch {
  /* no .env */
}
// Every terminal, hook and gitnexus call resolves its binary through PATH,
// which a packaged app launched outside a shell does not have.
if (app.isPackaged) {
  const shellPath = loginShellPath();
  if (shellPath) process.env.PATH = shellPath;
}

const ttsKey = () => process.env.ELEVENLABS_API_KEY ?? "";

async function resolveRootPath(): Promise<string> {
  if (process.env.VAULT_PATH) return process.env.VAULT_PATH;

  const store = path.join(app.getPath("userData"), "jarvis-vault");
  const saved = await fs.readFile(store, "utf8").catch(() => null);
  // reuse the saved vault only if the folder is still there
  if (saved && (await isDirectory(saved))) return saved;

  const picked = dialog.showOpenDialogSync({
    title: "Pick your vault folder",
    properties: ["openDirectory"],
  });
  if (!picked?.length) {
    app.quit();
    process.exit(0);
  }
  await fs.writeFile(store, picked[0], "utf8");
  return picked[0];
}

app.whenReady().then(async () => {
  const rootPath = await resolveRootPath(); // unchanged (vault picker)
  const projectsPath = path.join(
    app.getPath("userData"),
    "jarvis-projects.json",
  );
  const extraPaths = await readProjects(projectsPath);
  const loaded = await loadWorkspaces(rootPath, extraPaths);
  const vault = loaded[0];

  // The orchestrator is its own workspace in userData, not the JARVIS repo.
  // isSelf living here is what moves .mcp.json, the home terminal pin and the
  // spoken voice off the repo — and what makes the repo an ordinary delegate
  // jarvis_send can target.
  //
  // Its folder is under userData and the hooks it is built from ship as
  // extraResource, so it exists in a packaged build too.
  const mainAgent = mainAgentWorkspace(
    path.join(app.getPath("userData"), "main-agent"),
  );
  // Scratch sits beside it: the place for jobs that belong to no project.
  const scratch = scratchWorkspace(
    path.join(app.getPath("userData"), "scratch"),
  );
  await ensureScratch(scratch.rootPath).catch((err) =>
    console.error("[jarvis] scratch folder failed:", err),
  );
  const workspaces = withMainAgent(loaded, mainAgent, scratch);

  // The agent writes TODO.md with its own tools; the panel writes it only
  // through this store.
  const todosPath = path.join(mainAgent.rootPath, "TODO.md");
  const todoIO = fileTodoIO(todosPath);
  const todoStore = createTodoStore(todoIO, () => todayLocal());

  // graphs load lazily per workspace and stay cached until rescan
  const graphs = new Map<string, Promise<VaultGraph>>();
  // the open question per workspace. Deliberately not in the status store:
  // WorkspaceStatus is persisted to the inbox file, and a question's full
  // text and options do not belong on disk.
  const asks = new Map<string, AskPrompt>();
  const fingerprintOf = (ws: Workspace): Promise<string | null> =>
    sourceById(ws.sourceId)?.fingerprint?.(ws) ?? Promise.resolve(null);
  // every load carries the fingerprint of the index it read, so a card's save
  // names the graph it drew rather than whatever is on disk when it arrives
  const loadGraph = (ws: Workspace): Promise<VaultGraph> =>
    loadFingerprinted(
      () =>
        sourceById(ws.sourceId)?.load(ws) ??
        Promise.resolve({ nodes: [], edges: [] }),
      () => fingerprintOf(ws),
    );
  const graphFor = (id: string): Promise<VaultGraph> => {
    const ws = workspaces.find((w) => w.id === id);
    if (!ws) return Promise.resolve({ nodes: [], edges: [] });
    return cachedGraph(graphs, id, () => loadGraph(ws));
  };

  // symbol graphs are a second, independent per-workspace cache — the file
  // graph the rail/cards/preview use is never evicted by opening the symbol view
  const symbolGraphs = new Map<string, Promise<VaultGraph>>();
  const symbolGraphFor = (id: string): Promise<VaultGraph> => {
    const ws = workspaces.find((w) => w.id === id);
    if (!ws) return Promise.resolve({ nodes: [], edges: [] });
    // sources own their error handling; a source with no symbol level
    // serves an empty graph rather than main knowing what a gitnexus is
    return cachedGraph(
      symbolGraphs,
      id,
      () =>
        sourceById(ws.sourceId)?.loadSymbols?.(ws) ??
        Promise.resolve({ nodes: [], edges: [] }),
    );
  };

  const snapshotDir = path.join(app.getPath("userData"), "card-snapshots");
  const dropSnapshot = (id: string) =>
    deleteSnapshot(snapshotDir, id).catch((err) =>
      console.error("snapshot delete failed:", err),
    );
  ipcMain.handle("get-card-snapshots", () =>
    readSnapshots(snapshotDir, workspaces, fingerprintOf),
  );
  ipcMain.handle(
    "save-card-snapshot",
    async (
      _e,
      id: string,
      body: { look: string; layout: CardLayout; fingerprint?: string },
    ): Promise<boolean> => {
      const ws = workspaces.find((w) => w.id === id);
      try {
        return await saveSnapshot(snapshotDir, ws, body);
      } catch (err) {
        console.error("snapshot save failed:", err);
        return false;
      }
    },
  );

  ipcMain.handle("get-workspaces", () => workspaces);
  ipcMain.handle("get-graph", (_e, id: string) => graphFor(id));
  ipcMain.handle("get-symbol-graph", (_e, id: string) => symbolGraphFor(id));
  // returns the command that rebuilds this source, or null when it is fresh —
  // a source with no reindexCommand never offers the button
  ipcMain.handle(
    "stale-reindex-command",
    async (_e, id: string): Promise<string | null> => {
      const ws = workspaces.find((w) => w.id === id);
      if (!ws) return null;
      const src = sourceById(ws.sourceId);
      if (!src?.stale || !src.reindexCommand) return null;
      return (await src.stale(ws.rootPath)) ? src.reindexCommand : null;
    },
  );
  ipcMain.handle("rescan", async (_e, id: string) => {
    const ws = workspaces.find((w) => w.id === id);
    if (!ws) return { nodes: [], edges: [] };
    // re-probe: a source can appear after boot (`/graphify .` or `gitnexus
    // analyze` run in the workspace's own terminal), and refresh is how you say so
    ws.sourceId = await resolveSourceId(ws);
    void dropSnapshot(id);
    const g = await loadGraph(ws);
    // a failed rescan is returned but not cached, so the next ask reads again
    if (g.failed) graphs.delete(id);
    else graphs.set(id, Promise.resolve(g));
    symbolGraphs.delete(id);
    return g;
  });

  ipcMain.handle("add-project", async () => {
    const picked = dialog.showOpenDialogSync({
      title: "Add a project folder",
      properties: ["openDirectory"],
    });
    if (!picked?.length) return workspaces; // cancelled
    const rootPathPicked = picked[0];
    const id = normalizeId(rootPathPicked);
    if (workspaces.some((w) => w.id === id)) return workspaces; // already here

    const ws: Workspace = {
      id,
      name: path.basename(rootPathPicked),
      rootPath: rootPathPicked,
      kind: "code",
      sourceId: "unknown",
    };
    ws.sourceId = await resolveSourceId(ws);

    // pushed, never reassigned: startListener holds this array through a
    // () => workspaces getter and the IPC handlers reach it via .find
    workspaces.push(ws);
    extraPaths.push(rootPathPicked);
    await saveProjects(projectsPath, extraPaths).catch(console.error);
    return workspaces;
  });

  ipcMain.handle("index-project", async (_e, id: string) => {
    const ws = workspaces.find((w) => w.id === id);
    if (!ws) return { ok: false, error: "unknown workspace" };
    try {
      await runAnalyze(ws.rootPath);
    } catch (err) {
      // the renderer only has room for this in a tooltip — keep the full text
      // where it can be read
      console.error(`gitnexus analyze failed in ${ws.rootPath}:`, err);
      return { ok: false, error: (err as Error).message };
    }
    // gitnexus picks the registered name itself; the basename guessed at add
    // time would keep failing every loadCodeGraph until it is corrected
    const registry = await fs
      .readFile(path.join(os.homedir(), ".gitnexus", "registry.json"), "utf8")
      .catch(() => null);
    const name = nameFromRegistry(registry, ws.rootPath);
    if (name) ws.name = name;
    ws.sourceId = await resolveSourceId(ws);
    void dropSnapshot(ws.id);
    graphs.delete(ws.id); // next get-graph/rescan re-reads the fresh index
    symbolGraphs.delete(ws.id);
    return { ok: true };
  });

  const settingsPath = path.join(
    app.getPath("userData"),
    "jarvis-settings.json",
  );
  let settings = await loadSettings(settingsPath);
  ipcMain.handle("get-settings", () => settings);
  ipcMain.handle("set-settings", async (_e, s: Settings) => {
    settings = s;
    await saveSettings(settingsPath, settings);
  });

  // Head models: the renderer names one and gets bytes back, so no renderer
  // path ever reaches the disk.
  const userData = app.getPath("userData");
  ipcMain.handle("list-head-models", () => listHeads(userData));
  ipcMain.handle("read-head-model", (_e, name: string) =>
    readHead(userData, String(name ?? "")),
  );
  ipcMain.handle("pick-head-model", async () => {
    const picked = dialog.showOpenDialogSync({
      title: "Choose a head model",
      filters: [{ name: "glTF binary", extensions: ["glb"] }],
      properties: ["openFile"],
    });
    if (!picked?.length) return {}; // cancelled
    try {
      return { name: await importHead(userData, picked[0]) };
    } catch (err) {
      // The reason travels: swallowing it here made a refused upload look
      // exactly like a cancelled one, so the head simply never appeared.
      console.error("head model import failed:", err);
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  // The daily briefing's notes folder. The app knows nothing about vaults or
  // a memory/raw layout: it reads the newest *.md in whatever folder this
  // names, and null is the off switch.
  ipcMain.handle(
    "get-notes-dir",
    async () => (await readBriefing(userData)).notesDir,
  );
  ipcMain.handle("pick-notes-dir", async () => {
    const picked = dialog.showOpenDialogSync({
      title: "Choose the daily-notes folder",
      properties: ["openDirectory"],
    });
    const current = await readBriefing(userData);
    if (!picked?.length) return current.notesDir; // cancelled
    await writeBriefing(userData, { ...current, notesDir: picked[0] });
    return picked[0];
  });
  ipcMain.handle("clear-notes-dir", async () => {
    const current = await readBriefing(userData);
    await writeBriefing(userData, { ...current, notesDir: null });
    return null;
  });

  const tts = createTts({ fetch: globalThis.fetch });
  const edge = createEdgeTts({
    Client: MsEdgeTTS,
    log: (line) =>
      void appendCapped(
        path.join(app.getPath("userData"), "edge-tts.log"),
        line,
      ),
  });
  ipcMain.handle("tts-speak", async (_e, text: string) => {
    const cfg = {
      apiKey: ttsKey(),
      voiceId: settings.ttsVoiceId ?? "",
      modelId: settings.ttsModelId ?? "eleven_multilingual_v2",
    };
    const line = String(text ?? "");
    const eleven = await tts.speak(cfg, line);
    const bytes = eleven ?? (await edge.speak(line));
    // the renderer answers null by speaking through speechSynthesis, which
    // sounds nothing like the chosen voice. Say which half was missing and
    // which tier answered instead, or the fallback looks like the setting
    // being ignored.
    if (!eleven) {
      console.warn(
        `[tts] elevenlabs no audio — key:${cfg.apiKey ? "set" : "MISSING"} voice:${cfg.voiceId || "MISSING"} model:${cfg.modelId} → ${bytes ? "edge" : "edge failed, OS voice"}`,
      );
    }
    return bytes;
  });
  ipcMain.handle("tts-voices", () => tts.voices(ttsKey()));
  ipcMain.handle("tts-models", () => tts.models(ttsKey()));

  Menu.setApplicationMenu(null); // kills File/Edit/View… and their accelerators
  // Sized off the display, not a fixed 1400x900: the panel defaults are all
  // percentages of the window, so the window itself has to scale with the
  // screen or the whole HUD is laid out for a monitor the user may not have.
  // workAreaSize excludes the taskbar, so nothing opens underneath it.
  const { workAreaSize } = screen.getPrimaryDisplay();
  const win = new BrowserWindow({
    width: Math.round(workAreaSize.width * 0.8),
    height: Math.round(workAreaSize.height * 0.85),
    backgroundColor: "#02060b",
    // A packaged build carries the icon in its executable; `npm start` runs
    // the stock Electron binary, which only shows ours when handed it here.
    ...(app.isPackaged
      ? {}
      : { icon: path.join(app.getAppPath(), "assets", "icon.png") }),
    webPreferences: { preload: path.join(__dirname, "preload.js") },
  });
  if (!app.isPackaged && process.platform === "darwin")
    app.dock?.setIcon(path.join(app.getAppPath(), "assets", "icon.png"));

  // preview links: window.open(http…) from the renderer lands here
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });

  // raw note HTML must never navigate the app window itself
  win.webContents.on("will-navigate", (e) => e.preventDefault());

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    // menu removal also removes Ctrl+Shift+I — keep F12 in dev
    win.webContents.on("before-input-event", (_e, input) => {
      if (input.type === "keyDown" && input.key === "F12")
        win.webContents.toggleDevTools();
    });
  }

  // a node's file inside its workspace, or null for anything that escapes it
  const noteFile = (workspaceId: string, nodeId: string) => {
    const ws = workspaces.find((w) => w.id === workspaceId);
    if (!ws) return null;
    const file = ws.kind === "vault" ? `${nodeId}.md` : nodeId;
    const abs = path.resolve(ws.rootPath, file);
    const rel = path.relative(ws.rootPath, abs);
    if (rel.startsWith("..") || path.isAbsolute(rel)) return null; // stay inside
    return { root: ws.rootPath, abs, rel };
  };

  ipcMain.handle(
    "read-note",
    async (_e, workspaceId: string, nodeId: string) => {
      const file = noteFile(workspaceId, nodeId);
      return file ? fs.readFile(file.abs, "utf8").catch(() => null) : null;
    },
  );

  ipcMain.handle(
    "line-changes",
    (_e, workspaceId: string, nodeId: string): Promise<LineChanges> => {
      const file = noteFile(workspaceId, nodeId);
      return file
        ? lineChanges(file.root, file.rel)
        : Promise.resolve({ added: [], modified: [], removedAfter: [] });
    },
  );

  const send = (channel: string, payload: unknown, ...rest: unknown[]) => {
    if (win.isDestroyed() || win.webContents.isDestroyed()) return;
    win.webContents.send(channel, payload, ...rest);
  };

  ipcMain.handle("get-todos", () => todoStore.list());
  ipcMain.handle("todo-op", async (_e, op: TodoOp) => {
    const result = await todoStore.apply(op);
    // push now rather than wait for the watcher, so the panel never shows the
    // old row for a frame after its own click
    // not awaited: the write already happened, so a failed re-read must not
    // report the op as unsaved
    if (result.ok)
      todoStore
        .list()
        .then((list) => send("todos", list))
        .catch(console.error);
    return result;
  });

  const inboxPath = path.join(app.getPath("userData"), "jarvis-inbox.json");
  const status = createStatusStore(() => workspaces.map((w) => w.id));
  status.restore(
    await fs
      .readFile(inboxPath, "utf8")
      .then((t) => JSON.parse(t) as unknown)
      .catch(() => null), // missing or corrupt → the inbox just starts empty
  );

  // the renderer only ever receives pushes, so a restored inbox needs one
  win.webContents.on("did-finish-load", () =>
    send("status", status.snapshot()),
  );

  // orchestrator writes bypass this: only the user's own keystrokes are noted
  const pendingInput = createPendingInput();
  const orchestrator = createOrchestrator({
    getWorkspaces: () => workspaces,
    snapshot: () => status.snapshot(),
    sessionsOf: (id) => sessions.forWorkspace(id),
    hasPty: (key) => ptyManager.has(key),
    hasPendingInput: (key) => pendingInput.has(key),
    write: (key, data) => ptyManager.write(key, data),
    // the terminal's own defaults — Opus, permissions on — at placeholder
    // geometry the panel resizes when it attaches, as with the main agent.
    // The orchestrator waits for the new TUI to go quiet itself.
    launch: (ws, label) =>
      launchSession(ws, {
        label,
        cols: 80,
        rows: 24,
        dangerous: false,
        model: "opus",
      }),
    close: (key) => closeSession(key, true),
    isTrusted: (folder) => isTrusted(folder),
    waitQuiet: (key) => settle.wait(key, LAUNCH_SETTLE_DEADLINE_MS),
    msSinceOutput: (key) => Date.now() - (lastOutputAt.get(key) ?? -Infinity),
    // markDelegated is a status change like any other — push it to the rail
    markDelegated: (key, by) =>
      pushStatus(status.markDelegated(key, by, Date.now())),
    nameSession: (key, word) => pushStatus(status.setTopic(key, word, true)),
    // false when the window is gone; say() reports that rather than going
    // silent, so the agent learns its summary was not heard
    say: (text) => {
      if (win.isDestroyed() || win.webContents.isDestroyed()) return false;
      win.webContents.send("tts-say", text);
      return true;
    },
    // No session yet means the write fails and the finish just waits in the
    // queue for whenever one starts.
    nudgeMain: () => {
      typeNudge((data) => ptyManager.write(mainAgent.id, data), FINISH_NUDGE);
    },
  });

  let savedInbox = "";
  const pushStatus = (changed: boolean) => {
    if (!changed) return;
    const snap = status.snapshot();
    send("status", snap);
    // only Stop carries a message, so this writes rarely despite the call site
    const json = JSON.stringify(snap.filter((s) => s.message));
    if (json === savedInbox) return;
    savedInbox = json;
    fs.writeFile(inboxPath, json, "utf8").catch((err) =>
      console.error("inbox save failed:", err),
    );
  };

  // one sweep for every workspace — Esc leaves "running" with no Stop to end
  // it, and the TUI goes quiet after Esc while it keeps printing through a
  // long tool call
  const sweepTimer = setInterval(() => {
    const now = Date.now();
    pushStatus(
      status.sweep(now, (key) => now - (lastOutputAt.get(key) ?? -Infinity)),
    );
  }, STALE_MS / 4);
  app.on("before-quit", () => clearInterval(sweepTimer));

  // file-watching stays vault-only; code graphs refresh via rescan
  watchVault(
    vault.rootPath,
    (g) => {
      void dropSnapshot(vault.id);
      graphs.set(vault.id, Promise.resolve(g));
      send("graph", g);
    },
    () => loadGraph(vault),
  );

  // --- PTY ---
  // node-pty is a native module loaded on first launch, never at boot: a bad
  // ABI or a missing prebuild must degrade to "no terminal", not "no app".
  let ptySpawn: SpawnFn | null = null;
  const loadPtySpawn = (): SpawnFn => {
    if (!ptySpawn) {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const nodePty = require("node-pty") as { spawn: SpawnFn };
      ptySpawn = (file, args, opts) => nodePty.spawn(file, args, opts);
    }
    return ptySpawn;
  };
  // the briefing and jarvis_launch both wait for a new session to stop painting
  const settle = createSettle(SETTLE_MS);
  // a fresh send reads this to tell a quiet terminal from one mid-command
  const lastOutputAt = new Map<string, number>();
  // set only while a typed briefing waits for its UserPromptSubmit
  let onMainPrompt: ((prompt: string) => void) | null = null;
  // one feed for every session: the screen reads the transcript, never the pty
  const feed = createTranscriptFeed((key, entries, reset) =>
    send("transcript", key, entries, reset),
  );
  const lastStatusLine = new Map<string, StatusLineView>();
  // the renderer caches per key, so a key that may be reused is cleared there too
  function stopFeed(key: string): void {
    feed.stop(key);
    lastStatusLine.delete(key);
    send("transcript", key, [], true);
    send("statusline", key, null);
  }
  const ptyManager = createPtyManager(
    (file, args, opts) => loadPtySpawn()(file, args, opts),
    {
      onData: (id, data) => {
        send("pty-data", id, data);
        settle.bump(id);
        lastOutputAt.set(id, Date.now());
      },
      onExit: (id, code) => {
        send("pty-exit", id, code);
        pendingInput.clear(id);
        if (id.includes("#")) stopFeed(id);
        pushStatus(status.ptyExited(id, Date.now(), code));
      },
    },
  );

  // The topic is stored before the finish is published: the spoken summary and
  // the tab both read it from the snapshot. A failed read still finishes.
  async function onStop(s: StatusEvent, message: string): Promise<void> {
    const ws = workspaces.find((w) => w.id === s.workspaceId);
    const { label } = parseSessionKey(s.sessionKey, [s.workspaceId]);
    if (
      ws &&
      !ws.isSelf &&
      !ws.isScratch &&
      label !== MAIN_LABEL &&
      s.transcriptPath
    ) {
      try {
        const title = await readAiTitle(s.transcriptPath);
        const word = topicWord(title ?? "", ws.name);
        if (word) pushStatus(status.setTopic(s.sessionKey, word));
      } catch {
        // no topic this turn; the finish below is still owed
      }
    }
    orchestrator.publishFinish(s.sessionKey, message);
  }

  // Any session's turn ending can be the merge that finishes a sibling's
  // work, so every idle worktree tab of the workspace is checked. The tab
  // whose Stop this is has ended its turn, so its repaint does not hold it.
  async function closeMergedTabs(
    workspaceId: string,
    stoppedKey: string,
  ): Promise<void> {
    try {
      const ws = workspaces.find((w) => w.id === workspaceId);
      if (!ws || ws.isSelf) return;
      for (const info of sessions.forWorkspace(workspaceId)) {
        if (!info.worktree || info.label === MAIN_LABEL) continue;
        if (await worktreeMerged(ws.rootPath, info.cwd)) {
          await orchestrator.closeIfIdle(info.key, info.key === stoppedKey);
        }
      }
    } catch (err) {
      console.error(`closing merged tabs in ${workspaceId} failed:`, err);
    }
  }

  // sessions whose hooks have reached the listener: proof that a typed prompt
  // can be confirmed by its UserPromptSubmit
  const hooksHeardFrom = new Set<string>();

  startListener(
    Number(process.env.JARVIS_PORT ?? DEFAULT_PORT),
    (e) => {
      send("tool-event", e);
      pushStatus(status.countTool(e));
    },
    (s) => {
      hooksHeardFrom.add(s.sessionKey);
      pushStatus(status.applyStatus(s));
      feedStatusEvent(feed, s, ptyManager.has(s.sessionKey));
      if (s.prompt !== undefined) send("prompt-submitted", s.sessionKey);
      // A finish is a Stop, and only a Stop carries a message. Read from the
      // event, not the snapshot: the workspace row is an aggregate, so it can
      // read working while another session's turn has just ended, and a
      // restored inbox or a sweep demotion is never mistaken for a finish.
      if (s.message !== undefined) {
        void onStop(s, s.message);
        void closeMergedTabs(s.workspaceId, s.sessionKey);
      }
      if (s.sessionKey === mainAgent.id && s.prompt !== undefined)
        onMainPrompt?.(s.prompt);
    },
    () => workspaces,
    {
      ...orchestrator,
      // opens the panel first: the answer is for the agent, the panel is for
      // the person who asked. send() drops it quietly when no window exists.
      todos: async () => {
        send("show-todos", null);
        const text = await todoIO.read();
        return { path: todosPath, text, malformed: parseTodos(text).malformed };
      },
    },
    (p) => {
      // no questions means that one workspace's question is over — several can
      // be open across the fleet, so only its own key goes
      if (p.questions.length === 0) asks.delete(p.workspaceId);
      else asks.set(p.workspaceId, p);
      send("ask", p);
    },
    (key, raw) => {
      const cwd =
        (raw.workspace as { current_dir?: string } | undefined)?.current_dir ??
        sessions.get(key)?.cwd ??
        (key === mainAgent.id ? mainAgent.rootPath : "");
      // the listener's try sees only synchronous throws
      void (cwd ? gitHead(cwd) : Promise.resolve({ branch: "", commit: "" }))
        .then((git) => {
          const view = toStatusLineView(raw, git);
          lastStatusLine.set(key, view);
          send("statusline", key, view);
        })
        .catch((): void => undefined);
    },
    // a /resume or /clear switches files before the session's next hook
    (s) => {
      hooksHeardFrom.add(s.sessionKey);
      feedStatusEvent(feed, s, ptyManager.has(s.sessionKey));
    },
  );

  // Claude Code spawns both of these as its own child processes, so they must
  // be real files on disk. extraResource drops src/hook beside the asar as
  // resources/hook; in dev it is still in the source tree.
  const hookDir = app.isPackaged
    ? path.join(process.resourcesPath, "hook")
    : path.join(app.getAppPath(), "src", "hook");
  const forwardPath = path.join(hookDir, "forward.mjs");
  const mcpPath = path.join(hookDir, "mcp.mjs");
  const sessions = createSessionRegistry();
  // a resumed session reports no id until its first hook, so the id it was
  // resumed with stands in — otherwise a close before any prompt forgets it
  const resumedWith = new Map<string, string>();
  // --continue picks the newest conversation in the folder, so the feed does too
  async function followNewest(key: string, cwd: string): Promise<void> {
    const file = await newestTranscript(transcriptDir(os.homedir(), cwd));
    if (file) void feed.follow(key, file);
  }
  // one launch path for the terminal's button, the tab bar's `+` and
  // jarvis_launch. No label means the next free number.
  async function launchSession(
    ws: Workspace,
    opts: {
      label?: string;
      cols: number;
      rows: number;
      dangerous: boolean;
      model?: string;
      resumeId?: string;
    },
  ): Promise<{
    ok: boolean;
    hooksOk: boolean;
    key?: string;
    label?: string;
    worktree?: string;
    error?: string;
  }> {
    const gitRepo = ws.kind === "code" && (await isGitRepo(ws.rootPath));
    const folders = gitRepo ? await existingWorktreeFolders(ws.rootPath) : [];
    // From here to the reservation nothing awaits, so a launch running
    // concurrently either sees this one's reservation or has already made its
    // own: labels stay distinct and the cap holds.
    const reserved = sessions.reserved(ws.id);
    const registered = sessions.forWorkspace(ws.id);
    const taken = [...registered, ...reserved].map((s) => s.label);
    const label = cleanLabel(opts.label ?? "") || nextLabel(taken, folders);
    const key = sessionKey(ws.id, label);
    // a key already launching is the same no-op as relaunching a live one
    if (reserved.some((r) => r.key === key))
      return { ok: true, hooksOk: true, key, label };
    const live =
      registered.filter((s) => ptyManager.has(s.key)).length + reserved.length;
    // relaunching a live key is a no-op in the pty manager, never a refusal
    if (!ptyManager.has(key) && live >= MAX_SESSIONS)
      return { ok: false, hooksOk: false, key, label, error: "cap" };
    sessions.reserve({ key, workspaceId: ws.id, label });
    try {
      return await startSession(ws, key, label, gitRepo, opts);
    } finally {
      sessions.release(key);
    }
  }

  async function startSession(
    ws: Workspace,
    key: string,
    label: string,
    gitRepo: boolean,
    opts: Parameters<typeof launchSession>[1],
  ): ReturnType<typeof launchSession> {
    const useWorktree = label !== MAIN_LABEL && gitRepo;
    let cwd = ws.rootPath;
    let created = false;
    if (useWorktree) {
      cwd = worktreePath(ws.rootPath, label);
      try {
        // a folder kept at an earlier close is reopened, not recreated
        if (!(await isDirectory(cwd))) {
          await createWorktree(ws.rootPath, label);
          created = true;
        }
      } catch (err) {
        console.error(`worktree create failed in ${ws.rootPath}:`, err);
        return {
          ok: false,
          hooksOk: false,
          key,
          label,
          error: (err as Error).message,
        };
      }
    }
    // hooks go in the session's own folder: settings.local.json is untracked,
    // so a worktree does not inherit the main folder's
    const hooksOk = await ensureHooks(cwd, forwardPath);
    const mcpOk = await ensureMcp(ws, mcpPath);
    // a relaunched main agent continues its conversation like the boot
    // launch does — /clear is the only reset, and it is the user's
    const resume = ws.isSelf
      ? await hasTranscript(transcriptDir(os.homedir(), ws.rootPath))
      : (opts.resumeId ?? false);
    const result = {
      hooksOk: hooksOk && mcpOk,
      key,
      label,
      ...(useWorktree ? { worktree: cwd } : {}),
    };
    try {
      ptyManager.launch(
        key,
        cwd,
        opts.cols,
        opts.rows,
        opts.dangerous,
        opts.model,
        resume,
        (await userStatusLine(os.homedir(), cwd)) ?? undefined,
      );
      pendingInput.clear(key);
      if (ws.isSelf && resume === true) void followNewest(key, cwd);
      if (opts.resumeId)
        void feed.follow(
          key,
          path.join(transcriptDir(os.homedir(), cwd), `${opts.resumeId}.jsonl`),
        );
      const now = Date.now();
      const launched = status.ptyLaunched(key, now);
      const opened = status.sessionOpened(key, useWorktree, now);
      pushStatus(launched || opened);
    } catch (err) {
      // native load or spawn failure — the terminal reports it, app lives on
      console.error("pty launch failed:", err);
      // a worktree made for this launch holds nothing yet, so it goes too
      if (created)
        await removeWorktreeIfDone(ws.rootPath, cwd).catch((e) =>
          console.error(`worktree remove failed in ${ws.rootPath}:`, e),
        );
      return { ok: false, ...result, error: (err as Error).message };
    }
    sessions.add({
      key,
      workspaceId: ws.id,
      label,
      cwd,
      worktree: useWorktree,
    });
    return { ok: true, ...result };
  }

  // Ends a session and forgets it. A worktree is removed only when nothing in
  // it would be lost; otherwise `kept` names the folder and why it stays. A
  // killed pty's exit is never reported by the pty manager, so the status and
  // the renderer hear about it here. The removal waits for the process to
  // exit, because a live cwd cannot be deleted on Windows. Unless `force`, a
  // worktree holding work stops the close before anything changes and `dirty`
  // says why.
  async function closeSession(
    key: string,
    force = false,
  ): Promise<{ ok: boolean; kept?: string; dirty?: string }> {
    const pending = sessions.get(key);
    if (!force && pending?.worktree) {
      const ws = workspaces.find((w) => w.id === pending.workspaceId);
      if (ws) {
        const check = await worktreeCheck(ws.rootPath, pending.cwd);
        if (!check.clean) return { ok: false, dirty: check.reason };
      }
    }
    const info = sessions.remove(key);
    resumedWith.delete(key);
    stopFeed(key);
    const killed = await ptyManager.kill(key);
    if (killed) {
      pushStatus(status.ptyExited(key, Date.now(), 0));
      send("pty-exit", key, 0);
    }
    if (!info) return { ok: killed };
    if (!info.worktree) return { ok: true };
    const ws = workspaces.find((w) => w.id === info.workspaceId);
    if (!ws) return { ok: true, kept: `${info.cwd} (unknown workspace)` };
    try {
      const removed = await removeWorktreeIfDone(ws.rootPath, info.cwd);
      return removed.removed
        ? { ok: true }
        : { ok: true, kept: `${info.cwd} (${removed.reason})` };
    } catch (err) {
      console.error(`worktree remove failed in ${ws.rootPath}:`, err);
      return { ok: true, kept: `${info.cwd} (${(err as Error).message})` };
    }
  }

  ipcMain.handle(
    "pty-launch",
    (
      _e,
      workspaceId: string,
      label: string | null,
      cols: number,
      rows: number,
      dangerous: boolean,
      model: string | undefined,
    ) => {
      const ws = workspaces.find((w) => w.id === workspaceId);
      if (!ws) return { ok: false, hooksOk: false };
      return launchSession(ws, {
        label: label ?? undefined,
        cols,
        rows,
        dangerous,
        model,
      });
    },
  );
  ipcMain.handle("pty-close", (_e, key: string, force?: boolean) =>
    closeSession(String(key), force === true),
  );
  ipcMain.handle("get-transcript", (_e, key: string) =>
    feed.snapshot(String(key)),
  );
  ipcMain.handle(
    "get-statusline",
    (_e, key: string) => lastStatusLine.get(String(key)) ?? null,
  );
  ipcMain.handle("list-transcripts", (_e, key: string) => {
    const cwd =
      String(key) === mainAgent.id
        ? mainAgent.rootPath
        : sessions.get(String(key))?.cwd;
    return cwd
      ? listTranscripts(transcriptDir(os.homedir(), cwd))
      : Promise.resolve([]);
  });
  ipcMain.handle("save-pasted-image", (_e, bytes: Uint8Array, ext: string) => {
    if (!["png", "jpg", "gif", "webp"].includes(ext))
      throw new Error("unsupported image type");
    return savePastedImage(
      path.join(userData, "pasted-images"),
      bytes,
      ext as "png" | "jpg" | "gif" | "webp",
      Date.now(),
    );
  });
  ipcMain.handle("pty-input", (_e, id: string, data: string) => {
    // a session asking or blocked shows a picker, where a key is a choice
    const kind = status
      .snapshot()
      .flatMap((w) => w.sessions)
      .find((s) => s.key === id)?.kind;
    const pickerOpen = kind === "asking" || kind === "blocked";
    if (pendingInput.note(id, data, pickerOpen)) send("user-submitted", id);
    return ptyManager.write(id, data);
  });
  ipcMain.on("pty-resize", (_e, id: string, cols: number, rows: number) =>
    ptyManager.resize(id, cols, rows),
  );

  // The main agent owns the fleet watch and the voice, so it has to be running
  // before any delegate can finish. It is the only session every boot starts;
  // project terminals launch by hand, or resume after a recent close (below).
  let todosWatcher: FSWatcher | undefined;
  try {
    const guideRewritten = await ensureMainAgent(mainAgent.rootPath);
    // The folder exists now. Watching the folder, not the file, sees TODO.md
    // appear for the first time as well as every later write by either side.
    todosWatcher = watch(mainAgent.rootPath, {
      depth: 0,
      ignoreInitial: true,
      // writeFile truncates before it writes; a read in that gap pushes an
      // empty list and the panel flickers
      awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 25 },
    }).on("all", (_event, changed) => {
      if (path.basename(changed) !== "TODO.md") return;
      todoStore
        .list()
        .then((list) => send("todos", list))
        .catch(console.error);
    });
    await ensureHooks(mainAgent.rootPath, forwardPath);
    await ensureMcp(mainAgent, mcpPath);
    // a fresh install has no conversation to continue, and no history to brief
    const hasHistory = await hasTranscript(
      transcriptDir(os.homedir(), mainAgent.rootPath),
    );
    // a resumed conversation keeps the guide it loaded, so a rewrite starts fresh
    const resume = hasHistory && !guideRewritten;
    const briefing = await readBriefing(userData);
    const notesDir = briefing.notesDir;
    // the vault workspace reads the note; without one there is no one to ask
    const briefTo = workspaces.find(
      (w) => w.kind === "vault" && !w.isSelf && !w.isScratch,
    );
    // lastBriefed is the briefing's own record, not a transcript mtime: an
    // mtime gate is cancelled by any overnight write, and the morning
    // briefing would silently never fire.
    const due =
      notesDir !== null &&
      briefTo !== undefined &&
      hasHistory &&
      briefing.lastBriefed !== todayLocal() &&
      new Date().getHours() >= BRIEF_AFTER_HOUR;
    // registered before the launch so the first chunk starts the timer; a
    // session still busy at the deadline skips the day rather than typing
    // over it
    const settled = due
      ? settle.wait(mainAgent.id, SETTLE_DEADLINE_MS)
      : Promise.resolve(false);
    // the pull runs during the settle wait, so the launch never waits on the
    // network; the note is picked only once the vault is as fresh as it gets
    const pulled = due && notesDir ? pullNotes(notesDir) : Promise.resolve();
    // placeholder geometry — the terminal panel resizes the pty the moment it
    // attaches, so this size never reaches the screen
    ptyManager.launch(
      mainAgent.id,
      mainAgent.rootPath,
      80,
      24,
      false,
      MAIN_AGENT_MODEL,
      resume,
      (await userStatusLine(os.homedir(), mainAgent.rootPath)) ?? undefined,
    );
    if (resume) void followNewest(mainAgent.id, mainAgent.rootPath);
    pushStatus(status.ptyLaunched(mainAgent.id, Date.now()));
    void Promise.all([settled, pulled]).then(async ([ready]) => {
      if (!ready || !notesDir || !briefTo) return;
      const notes = await latestNotes(notesDir);
      if (notes.length === 0) return;
      const nudge = dailyBriefNudge(notes, briefTo.name);
      const write = (data: string) => ptyManager.write(mainAgent.id, data);
      const outcome = new Promise<boolean>((resolve) => {
        onMainPrompt = (prompt) => {
          onMainPrompt = null;
          resolve(prompt.startsWith("Daily briefing."));
        };
      });
      const landed = await deliverBriefing({
        type: () => typeNudge(write, nudge),
        msSinceOutput: () =>
          Date.now() - (lastOutputAt.get(mainAgent.id) ?? -Infinity),
        hooksHeard: () => hooksHeardFrom.has(mainAgent.id),
        outcome,
      });
      onMainPrompt = null;
      // unconfirmed leaves the day unstamped, so the next boot briefs again
      if (!landed) return;
      // re-read: the folder may have been picked since boot
      void readBriefing(userData)
        .then((b) =>
          writeBriefing(userData, { ...b, lastBriefed: todayLocal() }),
        )
        .catch(console.error);
    });
  } catch (err) {
    // no claude on PATH, node-pty failed to load, or the folder could not be
    // created. There is no terminal open yet to print into, so the console is
    // the only place to say it.
    console.error("[jarvis] main agent failed to launch:", err);
  }

  // Project sessions live at the last close come back if the app reopens
  // within the window. Read before the first heartbeat overwrites the file.
  const toResume = sessionsToResume(
    await readSavedSessions(userData),
    Date.now(),
    (id) => workspaces.find((w) => w.id === id)?.rootPath,
  );
  const saveSessions = () => {
    const live: Record<string, SavedSession> = {};
    for (const key of ptyManager.keys()) {
      if (key === mainAgent.id) continue;
      const info = sessions.get(key);
      const sid = status.sessionId(key) || resumedWith.get(key);
      if (info && sid)
        live[key] = { sessionId: sid, label: info.label, cwd: info.cwd };
    }
    writeSavedSessions(userData, live, Date.now());
  };
  const heartbeat = setInterval(saveSessions, HEARTBEAT_MS);
  // the terminal's defaults (Opus, permissions on), as jarvis_launch uses.
  // A session with no id, or whose transcript is gone, is left for a manual
  // launch rather than started fresh. Scratch comes back by the same rule: only
  // when it was live at the last close.
  const workspaceIds = workspaces.map((w) => w.id);
  for (const [key, saved] of Object.entries(toResume)) {
    const { workspaceId } = parseSessionKey(key, workspaceIds);
    const ws = workspaces.find((w) => w.id === workspaceId && !w.isSelf);
    if (!ws) continue;
    // transcripts are filed by folder, so a worktree session's is its own
    const dir = transcriptDir(os.homedir(), saved.cwd);
    if (!(await hasSessionTranscript(dir, saved.sessionId))) continue;
    resumedWith.set(key, saved.sessionId);
    void launchSession(ws, {
      label: saved.label,
      cols: 80,
      rows: 24,
      dangerous: false,
      model: "opus",
      resumeId: saved.sessionId,
    });
  }

  app.on("before-quit", () => {
    clearInterval(heartbeat);
    // before killAll, while every pty still counts as live
    saveSessions();
    feed.stopAll();
    ptyManager.killAll();
    void todosWatcher?.close();
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    win.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    win.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }
});

app.on("window-all-closed", () => app.quit());
