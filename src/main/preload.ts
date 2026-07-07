import { contextBridge, ipcRenderer } from "electron";
import type { ToolEvent, VaultGraph } from "../shared/types";

const api = {
  onGraph: (cb: (g: VaultGraph) => void) => {
    ipcRenderer.on("graph", (_e, g: VaultGraph) => cb(g));
  },
  onToolEvent: (cb: (e: ToolEvent) => void) => {
    ipcRenderer.on("tool-event", (_e, t: ToolEvent) => cb(t));
  },
  readNote: (nodeId: string): Promise<string | null> =>
    ipcRenderer.invoke("read-note", nodeId),
};

contextBridge.exposeInMainWorld("jarvis", api);

export type JarvisApi = typeof api;