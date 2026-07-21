import { contextBridge, ipcRenderer } from "electron";
import type {
  Settings,
  ToolEvent,
  VaultGraph,
  Workspace,
} from "../shared/types";

const api = {
  getWorkspaces: (): Promise<Workspace[]> =>
    ipcRenderer.invoke("get-workspaces"),
  getGraph: (workspaceId: string): Promise<VaultGraph> =>
    ipcRenderer.invoke("get-graph", workspaceId),
  onGraph: (cb: (g: VaultGraph) => void) => {
    ipcRenderer.on("graph", (_e, g: VaultGraph) => cb(g));
  },
  onToolEvent: (cb: (e: ToolEvent) => void) => {
    ipcRenderer.on("tool-event", (_e, t: ToolEvent) => cb(t));
  },
  readNote: (workspaceId: string, nodeId: string): Promise<string | null> =>
    ipcRenderer.invoke("read-note", workspaceId, nodeId),
  getSettings: (): Promise<Settings> => ipcRenderer.invoke("get-settings"),
  setSettings: (s: Settings): Promise<void> =>
    ipcRenderer.invoke("set-settings", s),
  rescan: (workspaceId: string): Promise<VaultGraph> =>
    ipcRenderer.invoke("rescan", workspaceId),
  ptyLaunch: (
    workspaceId: string,
    cols: number,
    rows: number,
    dangerous = false,
  ): Promise<{ ok: boolean; hooksOk: boolean }> =>
    ipcRenderer.invoke("pty-launch", workspaceId, cols, rows, dangerous),
  ptyInput: (workspaceId: string, data: string): void => {
    ipcRenderer.send("pty-input", workspaceId, data);
  },
  ptyResize: (workspaceId: string, cols: number, rows: number): void => {
    ipcRenderer.send("pty-resize", workspaceId, cols, rows);
  },
  onPtyData: (cb: (workspaceId: string, data: string) => void) => {
    ipcRenderer.on("pty-data", (_e, id: string, d: string) => cb(id, d));
  },
  onPtyExit: (cb: (workspaceId: string, exitCode: number) => void) => {
    ipcRenderer.on("pty-exit", (_e, id: string, c: number) => cb(id, c));
  },
};

contextBridge.exposeInMainWorld("jarvis", api);

export type JarvisApi = typeof api;
