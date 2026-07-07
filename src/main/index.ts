import { app, BrowserWindow, dialog, ipcMain } from "electron";
import path from "node:path";
import { promises as fs } from "node:fs";
import started from "electron-squirrel-startup";
import { scanVault } from "./vault-graph";
import { startListener, DEFAULT_PORT } from "./http-listener";
import { watchVault } from "./watcher";
import type { Workspace } from "../shared/types";

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
  const workspace: Workspace = {
    id: "vault",
    name: path.basename(rootPath),
    rootPath,
  };

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

  win.webContents.on("did-finish-load", async () => {
    send("workspace", workspace);
    send("graph", await scanVault(rootPath));
  });

  startListener(Number(process.env.JARVIS_PORT ?? DEFAULT_PORT), (e) =>
    send("tool-event", e),
  );
  watchVault(rootPath, (g) => send("graph", g));

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    win.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    win.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }
});

app.on("window-all-closed", () => app.quit());