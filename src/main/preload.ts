import { contextBridge, ipcRenderer } from "electron";
import type { Settings, ToolEvent, VaultGraph } from "../shared/types";

const api = {
  getGraph: (): Promise<VaultGraph> => ipcRenderer.invoke("get-graph"),
  onGraph: (cb: (g: VaultGraph) => void) => {
    ipcRenderer.on("graph", (_e, g: VaultGraph) => cb(g));
  },
  onToolEvent: (cb: (e: ToolEvent) => void) => {
    ipcRenderer.on("tool-event", (_e, t: ToolEvent) => cb(t));
  },
  readNote: (nodeId: string): Promise<string | null> =>
    ipcRenderer.invoke("read-note", nodeId),
  getSettings: (): Promise<Settings> => ipcRenderer.invoke("get-settings"),
  setSettings: (s: Settings): Promise<void> =>
    ipcRenderer.invoke("set-settings", s),
};

contextBridge.exposeInMainWorld("jarvis", api);

export type JarvisApi = typeof api;
