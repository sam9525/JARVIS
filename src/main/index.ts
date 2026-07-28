import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from "electron";
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
import { loadSymbolGraph } from "./gitnexus-graph";
import { resolveSourceId, sourceById } from "./graph-sources/registry";
import { isDirectory } from "./is-directory";
import { runAnalyze } from "./graph-sources/gitnexus-source";
import { ensureHooks } from "./hook-install";
import { ensureMcp } from "./mcp-install";
import { createOrchestrator } from "./orchestrate";
import { createPtyManager, type SpawnFn } from "./pty-manager";
import { createStatusStore, STALE_MS } from "./workspace-status";
import type { Settings, VaultGraph, Workspace } from "../shared/types";

if (started) app.quit();

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
  const workspaces = await loadWorkspaces(rootPath, extraPaths);
  const vault = workspaces[0];

  // ponytail: dev-only match — packaged getAppPath() is an asar path that no
  // workspace can equal, so home falls back to the vault. Terminals are
  // dev-only anyway.
  const self = workspaces.find((w) => w.id === normalizeId(app.getAppPath()));
  if (self) self.isSelf = true;

  // graphs load lazily per workspace and stay cached until rescan
  const graphs = new Map<string, Promise<VaultGraph>>();
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
    if (!ws || ws.kind !== "code")
      return Promise.resolve({ nodes: [], edges: [] });
    let g = symbolGraphs.get(id);
    if (!g) {
      g = (async () => {
        return loadSymbolGraph(ws.name).catch((err) => {
          // gitnexus format drift / unreadable index → empty graph, no crash
          console.error(`symbol graph failed for ${ws.name}:`, err);
          return { nodes: [], edges: [] };
        });
      })();
      symbolGraphs.set(id, g);
    }
    return g;
  };

  ipcMain.handle("get-workspaces", () => workspaces);
  ipcMain.handle("get-graph", (_e, id: string) => graphFor(id));
  ipcMain.handle("get-symbol-graph", (_e, id: string) => symbolGraphFor(id));
  ipcMain.handle("source-stale", async (_e, id: string) => {
    const ws = workspaces.find((w) => w.id === id);
    if (!ws) return false;
    return (await sourceById(ws.sourceId)?.stale?.(ws.rootPath)) ?? false;
  });
  ipcMain.handle("rescan", async (_e, id: string) => {
    const ws = workspaces.find((w) => w.id === id);
    if (!ws) return { nodes: [], edges: [] };
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
    await saveSettings(settingsPath, s);
  });

  Menu.setApplicationMenu(null); // kills File/Edit/View… and their accelerators
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
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
        pushStatus(status.ptyExited(id, Date.now()));
      },
    },
  );

  const orchestrator = createOrchestrator({
    getWorkspaces: () => workspaces,
    snapshot: () => status.snapshot(),
    hasPty: (id) => ptyManager.has(id),
    write: (id, data) => ptyManager.write(id, data),
    // markDelegated is a status change like any other — push it to the rail
    markDelegated: (id, by) =>
      pushStatus(status.markDelegated(id, by, Date.now())),
  });

  startListener(
    Number(process.env.JARVIS_PORT ?? DEFAULT_PORT),
    (e) => {
      send("tool-event", e);
      pushStatus(status.countTool(e));
    },
    (s) => pushStatus(status.applyStatus(s)),
    () => workspaces,
    orchestrator,
  );

  const forwardPath = path.join(app.getAppPath(), "src", "hook", "forward.mjs");
  const mcpPath = path.join(app.getAppPath(), "src", "hook", "mcp.mjs");
  ipcMain.handle(
    "pty-launch",
    async (
      _e,
      workspaceId: string,
      cols: number,
      rows: number,
      dangerous: boolean,
    ) => {
      const ws = workspaces.find((w) => w.id === workspaceId);
      if (!ws) return { ok: false, hooksOk: false };
      const hooksOk = await ensureHooks(ws.rootPath, forwardPath);
      const mcpOk = await ensureMcp(ws, mcpPath);
      try {
        ptyManager.launch(ws, cols, rows, dangerous);
        pushStatus(status.ptyLaunched(ws.id, Date.now()));
      } catch (err) {
        // native load or spawn failure — the terminal reports it, app lives on
        console.error("pty launch failed:", err);
        return { ok: false, hooksOk: hooksOk && mcpOk };
      }
      return { ok: true, hooksOk: hooksOk && mcpOk };
    },
  );
  ipcMain.on("pty-input", (_e, id: string, data: string) =>
    ptyManager.write(id, data),
  );
  ipcMain.on("pty-resize", (_e, id: string, cols: number, rows: number) =>
    ptyManager.resize(id, cols, rows),
  );
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
