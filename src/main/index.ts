import { app, BrowserWindow, dialog, ipcMain } from "electron";
import path from "node:path";
import { promises as fs } from "node:fs";
import started from "electron-squirrel-startup";
import { scanVault } from "./vault-graph";
import { startListener, DEFAULT_PORT } from "./http-listener";
import { watchVault } from "./watcher";
import { loadSettings, saveSettings } from "./settings";
import type { Settings } from "../shared/types";

if (started) app.quit();

function resolveRootPath(): string {
  if (process.env.VAULT_PATH) return process.env.VAULT_PATH;
  const picked = dialog.showOpenDialogSync({
    title: "Pick your vault folder",
    properties: ["openDirectory"],
  });
  if (!picked?.length) {
    app.quit();
    process.exit(0);
  }
  return picked[0];
}

app.whenReady().then(async () => {
  const rootPath = resolveRootPath();
  let graph = scanVault(rootPath);
  ipcMain.handle("get-graph", () => graph);
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

  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    backgroundColor: "#0d1017",
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
