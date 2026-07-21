import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from "electron";
import path from "node:path";
import { promises as fs } from "node:fs";
import started from "electron-squirrel-startup";
import { scanVault } from "./vault-graph";
import { startListener, DEFAULT_PORT } from "./http-listener";
import { watchVault } from "./watcher";
import { autoGroups, loadSettings, saveSettings } from "./settings";
import { loadWorkspaces } from "./workspaces";
import { loadCodeGraph } from "./gitnexus-graph";
import { ensureHooks } from "./hook-install";
import { createPtyManager, type SpawnFn } from "./pty-manager";
import type { Settings, VaultGraph, Workspace } from "../shared/types";

if (started) app.quit();

async function resolveRootPath(): Promise<string> {
  if (process.env.VAULT_PATH) return process.env.VAULT_PATH;

  const store = path.join(app.getPath("userData"), "jarvis-vault");
  const saved = await fs.readFile(store, "utf8").catch(() => null);
  // reuse the saved vault only if the folder is still there
  if (
    saved &&
    (await fs.stat(saved).then(
      (s) => s.isDirectory(),
      () => false,
    ))
  ) {
    return saved;
  }

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
  const workspaces = await loadWorkspaces(rootPath);
  const vault = workspaces[0];

  // graphs load lazily per workspace and stay cached until rescan
  const graphs = new Map<string, Promise<VaultGraph>>();
  const loadGraph = (ws: Workspace): Promise<VaultGraph> =>
    ws.kind === "vault"
      ? scanVault(ws.rootPath)
      : loadCodeGraph(ws.name).catch((err) => {
          // gitnexus missing/format drift → terminal-only workspace, no crash
          console.error(`code graph failed for ${ws.name}:`, err);
          return { nodes: [], edges: [] };
        });
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

  ipcMain.handle("get-workspaces", () => workspaces);
  ipcMain.handle("get-graph", (_e, id: string) => graphFor(id));
  ipcMain.handle("rescan", async (_e, id: string) => {
    const ws = workspaces.find((w) => w.id === id);
    if (!ws) return { nodes: [], edges: [] };
    const g = await loadGraph(ws);
    graphs.set(id, Promise.resolve(g)); // assign only on success
    return g;
  });

  const settingsPath = path.join(
    app.getPath("userData"),
    "jarvis-settings.json",
  );
  let settings = await loadSettings(settingsPath);
  // first run (or user cleared every group): seed one group per top-level folder
  if (settings.groups.length === 0) {
    // a failed vault scan must not stop the window from opening — skip seeding
    const g = await graphFor(vault.id).catch(() => null);
    if (g) settings.groups = autoGroups(g);
    if (settings.groups.length > 0) await saveSettings(settingsPath, settings);
  }
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

  startListener(
    Number(process.env.JARVIS_PORT ?? DEFAULT_PORT),
    (e) => send("tool-event", e),
    () => workspaces,
  );
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
      onExit: (id, code) => send("pty-exit", id, code),
    },
  );
  const forwardPath = path.join(app.getAppPath(), "src", "hook", "forward.mjs");
  ipcMain.handle(
    "pty-launch",
    async (_e, workspaceId: string, cols: number, rows: number) => {
      const ws = workspaces.find((w) => w.id === workspaceId);
      if (!ws) return { ok: false, hooksOk: false };
      const hooksOk = await ensureHooks(ws.rootPath, forwardPath);
      try {
        ptyManager.launch(ws, cols, rows);
      } catch (err) {
        // native load or spawn failure — the terminal reports it, app lives on
        console.error("pty launch failed:", err);
        return { ok: false, hooksOk };
      }
      return { ok: true, hooksOk };
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
