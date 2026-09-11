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
import { ensureHooks } from "./hook-install";
import { ensureMcp } from "./mcp-install";
import { createOrchestrator } from "./orchestrate";
import { createPtyManager, type SpawnFn } from "./pty-manager";
import {
  FINISH_NUDGE,
  MAIN_AGENT_MODEL,
  ensureMainAgent,
  mainAgentWorkspace,
  withMainAgent,
} from "./main-agent";
import { createStatusStore, STALE_MS } from "./workspace-status";
import { createTts } from "./tts";
import { importHead, listHeads, readHead } from "./head-models";
import type { AskPrompt } from "./ask-mapper";
import type { Settings, VaultGraph, Workspace } from "../shared/types";

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
  const workspaces = withMainAgent(loaded, mainAgent);

  // graphs load lazily per workspace and stay cached until rescan
  const graphs = new Map<string, Promise<VaultGraph>>();
  // the open question per workspace. Deliberately not in the status store:
  // WorkspaceStatus is persisted to the inbox file, and a question's full
  // text and options do not belong on disk.
  const asks = new Map<string, AskPrompt>();
  const loadGraph = (ws: Workspace): Promise<VaultGraph> =>
    sourceById(ws.sourceId)?.load(ws) ??
    Promise.resolve({ nodes: [], edges: [] });
  const graphFor = (id: string): Promise<VaultGraph> => {
    const ws = workspaces.find((w) => w.id === id);
    if (!ws) return Promise.resolve({ nodes: [], edges: [] });
    let g = graphs.get(id);
    if (!g) {
      g = loadGraph(ws);
      graphs.set(id, g);
    }
    return g;
  };

  // symbol graphs are a second, independent per-workspace cache — the file
  // graph the rail/cards/preview use is never evicted by opening the symbol view
  const symbolGraphs = new Map<string, Promise<VaultGraph>>();
  const symbolGraphFor = (id: string): Promise<VaultGraph> => {
    const ws = workspaces.find((w) => w.id === id);
    if (!ws) return Promise.resolve({ nodes: [], edges: [] });
    let g = symbolGraphs.get(id);
    if (!g) {
      // sources own their error handling; a source with no symbol level
      // serves an empty graph rather than main knowing what a gitnexus is
      g =
        sourceById(ws.sourceId)?.loadSymbols?.(ws) ??
        Promise.resolve({ nodes: [], edges: [] });
      symbolGraphs.set(id, g);
    }
    return g;
  };

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
    const g = await loadGraph(ws);
    graphs.set(id, Promise.resolve(g)); // assign only on success
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

  const tts = createTts({ fetch: globalThis.fetch });
  ipcMain.handle("tts-speak", async (_e, text: string) => {
    const cfg = {
      apiKey: ttsKey(),
      voiceId: settings.ttsVoiceId ?? "",
      modelId: settings.ttsModelId ?? "eleven_multilingual_v2",
    };
    const bytes = await tts.speak(cfg, String(text ?? ""));
    // the renderer answers null by speaking through speechSynthesis, which
    // sounds nothing like the chosen voice. Say which half was missing, or
    // the fallback looks like the setting being ignored.
    if (!bytes) {
      console.warn(
        `[tts] no audio — key:${cfg.apiKey ? "set" : "MISSING"} voice:${cfg.voiceId || "MISSING"} model:${cfg.modelId}`,
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
    webPreferences: { preload: path.join(__dirname, "preload.js") },
  });

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

  ipcMain.handle(
    "read-note",
    async (_e, workspaceId: string, nodeId: string) => {
      const ws = workspaces.find((w) => w.id === workspaceId);
      if (!ws) return null;
      const file = ws.kind === "vault" ? `${nodeId}.md` : nodeId;
      const abs = path.resolve(ws.rootPath, file);
      const rel = path.relative(ws.rootPath, abs);
      if (rel.startsWith("..") || path.isAbsolute(rel)) return null; // stay inside
      return fs.readFile(abs, "utf8").catch(() => null);
    },
  );

  const send = (channel: string, payload: unknown, ...rest: unknown[]) => {
    if (win.isDestroyed() || win.webContents.isDestroyed()) return;
    win.webContents.send(channel, payload, ...rest);
  };

  const inboxPath = path.join(app.getPath("userData"), "jarvis-inbox.json");
  const status = createStatusStore();
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

  // What "a delegate finished" means here: an idle row whose message is new.
  // Diffing the snapshot is the honest read — the sweep also demotes to idle,
  // but it carries the same message, so it never fires this. Restoring the
  // inbox is a display concern — a card reading "idle, last said X" after a
  // restart — not a queuing one, so every row already on disk is seeded here
  // as already-announced before any live pushStatus can run. Without this,
  // the first pushStatus after boot — from any workspace, not necessarily
  // the restored one — would scan the whole snapshot and hand a fresh
  // orchestrator session a finish nobody asked it to watch for.
  const announced = new Map<string, string>();
  for (const row of status.snapshot()) {
    const message = row.message?.trim() ?? "";
    if (row.kind === "idle" && message) announced.set(row.workspaceId, message);
  }

  const orchestrator = createOrchestrator({
    getWorkspaces: () => workspaces,
    snapshot: () => status.snapshot(),
    hasPty: (id) => ptyManager.has(id),
    write: (id, data) => ptyManager.write(id, data),
    // markDelegated is a status change like any other — push it to the rail
    markDelegated: (id, by) =>
      pushStatus(status.markDelegated(id, by, Date.now())),
    // false when the window is gone; say() reports that rather than going
    // silent, so the agent learns its summary was not heard
    say: (text) => {
      if (win.isDestroyed() || win.webContents.isDestroyed()) return false;
      win.webContents.send("tts-say", text);
      return true;
    },
    // Same two-write shape as jarvis_send: Claude Code's TUI reads one
    // arriving chunk as a paste, so a trailing CR would land as a newline in
    // the composer instead of submitting. No session yet means write returns
    // false and the finish just waits in the queue for whenever one starts.
    nudgeMain: () => {
      if (!ptyManager.write(mainAgent.id, FINISH_NUDGE)) return;
      setTimeout(() => ptyManager.write(mainAgent.id, "\r"), 80);
    },
  });

  let savedInbox = "";
  const pushStatus = (changed: boolean) => {
    if (!changed) return;
    const snap = status.snapshot();
    send("status", snap);
    for (const row of snap) {
      const message = row.message?.trim() ?? "";
      if (row.kind !== "idle" || !message) continue;
      if (announced.get(row.workspaceId) === message) continue;
      announced.set(row.workspaceId, message);
      orchestrator.publishFinish(row.workspaceId, message);
    }
    // only Stop carries a message, so this writes rarely despite the call site
    const json = JSON.stringify(snap.filter((s) => s.message));
    if (json === savedInbox) return;
    savedInbox = json;
    fs.writeFile(inboxPath, json, "utf8").catch((err) =>
      console.error("inbox save failed:", err),
    );
  };

  // one sweep for every workspace — Esc leaves "running" with no Stop to end it
  const sweepTimer = setInterval(
    () => pushStatus(status.sweep(Date.now())),
    STALE_MS / 4,
  );
  app.on("before-quit", () => clearInterval(sweepTimer));

  // file-watching stays vault-only; code graphs refresh via rescan
  watchVault(vault.rootPath, (g) => {
    graphs.set(vault.id, Promise.resolve(g));
    send("graph", g);
  });

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
  const ptyManager = createPtyManager(
    (file, args, opts) => loadPtySpawn()(file, args, opts),
    {
      onData: (id, data) => send("pty-data", id, data),
      onExit: (id, code) => {
        send("pty-exit", id, code);
        pushStatus(status.ptyExited(id, Date.now(), code));
      },
    },
  );

  startListener(
    Number(process.env.JARVIS_PORT ?? DEFAULT_PORT),
    (e) => {
      send("tool-event", e);
      pushStatus(status.countTool(e));
    },
    (s) => pushStatus(status.applyStatus(s)),
    () => workspaces,
    orchestrator,
    (p) => {
      // no questions means that one workspace's question is over — several can
      // be open across the fleet, so only its own key goes
      if (p.questions.length === 0) asks.delete(p.workspaceId);
      else asks.set(p.workspaceId, p);
      send("ask", p);
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
  ipcMain.handle(
    "pty-launch",
    async (
      _e,
      workspaceId: string,
      cols: number,
      rows: number,
      dangerous: boolean,
      model: string | undefined,
    ) => {
      const ws = workspaces.find((w) => w.id === workspaceId);
      if (!ws) return { ok: false, hooksOk: false };
      const hooksOk = await ensureHooks(ws.rootPath, forwardPath);
      const mcpOk = await ensureMcp(ws, mcpPath);
      try {
        ptyManager.launch(ws, cols, rows, dangerous, model);
        pushStatus(status.ptyLaunched(ws.id, Date.now()));
      } catch (err) {
        // native load or spawn failure — the terminal reports it, app lives on
        console.error("pty launch failed:", err);
        return { ok: false, hooksOk: hooksOk && mcpOk };
      }
      return { ok: true, hooksOk: hooksOk && mcpOk };
    },
  );
  ipcMain.handle("pty-input", (_e, id: string, data: string) =>
    ptyManager.write(id, data),
  );
  ipcMain.on("pty-resize", (_e, id: string, cols: number, rows: number) =>
    ptyManager.resize(id, cols, rows),
  );

  // The main agent owns the fleet watch and the voice, so it has to be running
  // before any delegate can finish. It is the only session boot starts; project
  // terminals still launch by hand.
  try {
    await ensureMainAgent(mainAgent.rootPath);
    await ensureHooks(mainAgent.rootPath, forwardPath);
    await ensureMcp(mainAgent, mcpPath);
    // placeholder geometry — the terminal panel resizes the pty the moment it
    // attaches, so this size never reaches the screen
    ptyManager.launch(mainAgent, 80, 24, false, MAIN_AGENT_MODEL);
    pushStatus(status.ptyLaunched(mainAgent.id, Date.now()));
  } catch (err) {
    // no claude on PATH, node-pty failed to load, or the folder could not be
    // created. There is no terminal open yet to print into, so the console is
    // the only place to say it.
    console.error("[jarvis] main agent failed to launch:", err);
  }

  app.on("before-quit", () => ptyManager.killAll());

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    win.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    win.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }
});

app.on("window-all-closed", () => app.quit());
