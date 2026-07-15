import { app, BrowserWindow, dialog, ipcMain } from "electron";
import path from "node:path";
import { promises as fs } from "node:fs";
import started from "electron-squirrel-startup";
import { scanVault } from "./vault-graph";
import { startListener, DEFAULT_PORT } from "./http-listener";
import { watchVault } from "./watcher";
import { autoGroups, loadSettings, saveSettings } from "./settings";
import type { Settings } from "../shared/types";

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
  const rootPath = await resolveRootPath();
  let graph = scanVault(rootPath);
  ipcMain.handle("get-graph", () => graph);
  ipcMain.handle("rescan", async () => {
    // assign only on success — a rejected promise must not poison get-graph
    const g = await scanVault(rootPath);
    graph = Promise.resolve(g);
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
    const g = await graph.catch(() => null);
    if (g) settings.groups = autoGroups(g);
    if (settings.groups.length > 0) await saveSettings(settingsPath, settings);
  }
  ipcMain.handle("get-settings", () => settings);
  ipcMain.handle("set-settings", async (_e, s: Settings) => {
    settings = s;
    await saveSettings(settingsPath, s);
  });

  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    backgroundColor: "#02060b",
    webPreferences: { preload: path.join(__dirname, "preload.js") },
  });

  ipcMain.handle("read-note", async (_e, nodeId: string) => {
    const abs = path.resolve(rootPath, `${nodeId}.md`);
    const rel = path.relative(rootPath, abs);
    if (rel.startsWith("..") || path.isAbsolute(rel)) return null; // stay inside the vault
    return fs.readFile(abs, "utf8").catch(() => null);
  });

  const send = (channel: string, payload: unknown) =>
    win.webContents.send(channel, payload);

  startListener(Number(process.env.JARVIS_PORT ?? DEFAULT_PORT), (e) =>
    send("tool-event", e),
  );
  watchVault(rootPath, (g) => {
    graph = Promise.resolve(g); // keep 'get-graph' fresh for reloads
    send("graph", g);
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
