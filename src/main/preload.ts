import { contextBridge, ipcRenderer } from "electron";
import type {
  Settings,
  ToolEvent,
  VaultGraph,
  Workspace,
  WorkspaceStatus,
} from "../shared/types";
import type { TtsOption } from "./tts";

// Every subscription hands back its own disposer. Without one, a second mount
// (StrictMode, or any remount) silently doubles the listener.
function subscribe<A extends unknown[]>(
  channel: string,
  cb: (...args: A) => void,
): () => void {
  const handler = (_e: unknown, ...args: unknown[]) => cb(...(args as A));
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

const api = {
  getWorkspaces: (): Promise<Workspace[]> =>
    ipcRenderer.invoke("get-workspaces"),
  getGraph: (workspaceId: string): Promise<VaultGraph> =>
    ipcRenderer.invoke("get-graph", workspaceId),
  getSymbolGraph: (workspaceId: string): Promise<VaultGraph> =>
    ipcRenderer.invoke("get-symbol-graph", workspaceId),
  onGraph: (cb: (g: VaultGraph) => void) =>
    subscribe<[VaultGraph]>("graph", cb),
  onToolEvent: (cb: (e: ToolEvent) => void) =>
    subscribe<[ToolEvent]>("tool-event", cb),
  onStatus: (cb: (s: WorkspaceStatus[]) => void) =>
    subscribe<[WorkspaceStatus[]]>("status", cb),
  readNote: (workspaceId: string, nodeId: string): Promise<string | null> =>
    ipcRenderer.invoke("read-note", workspaceId, nodeId),
  getSettings: (): Promise<Settings> => ipcRenderer.invoke("get-settings"),
  setSettings: (s: Settings): Promise<void> =>
    ipcRenderer.invoke("set-settings", s),
  rescan: (workspaceId: string): Promise<VaultGraph> =>
    ipcRenderer.invoke("rescan", workspaceId),
  addProject: (): Promise<Workspace[]> => ipcRenderer.invoke("add-project"),
  indexProject: (
    workspaceId: string,
  ): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke("index-project", workspaceId),
  staleReindexCommand: (workspaceId: string): Promise<string | null> =>
    ipcRenderer.invoke("stale-reindex-command", workspaceId),
  ptyLaunch: (
    workspaceId: string,
    cols: number,
    rows: number,
    dangerous = false,
  ): Promise<{ ok: boolean; hooksOk: boolean }> =>
    ipcRenderer.invoke("pty-launch", workspaceId, cols, rows, dangerous),
  // returns whether a live PTY took the write, so a caller that is not a
  // keyboard (voice) can report a send into a dead session
  ptyInput: (workspaceId: string, data: string): Promise<boolean> =>
    ipcRenderer.invoke("pty-input", workspaceId, data),
  ptyResize: (workspaceId: string, cols: number, rows: number): void => {
    ipcRenderer.send("pty-resize", workspaceId, cols, rows);
  },
  // the key never crosses this bridge — main holds it, the renderer only ever
  // learns whether one exists and whether it could be encrypted
  ttsKeyState: (): Promise<{ hasKey: boolean; encrypted: boolean }> =>
    ipcRenderer.invoke("tts-key-state"),
  ttsSetKey: (
    plain: string,
  ): Promise<{ hasKey: boolean; encrypted: boolean }> =>
    ipcRenderer.invoke("tts-set-key", plain),
  ttsSpeak: (text: string): Promise<Uint8Array | null> =>
    ipcRenderer.invoke("tts-speak", text),
  ttsVoices: (): Promise<TtsOption[]> => ipcRenderer.invoke("tts-voices"),
  ttsModels: (): Promise<TtsOption[]> => ipcRenderer.invoke("tts-models"),
  onPtyData: (cb: (workspaceId: string, data: string) => void) =>
    subscribe<[string, string]>("pty-data", cb),
  onPtyExit: (cb: (workspaceId: string, exitCode: number) => void) =>
    subscribe<[string, number]>("pty-exit", cb),
};

contextBridge.exposeInMainWorld("jarvis", api);

export type JarvisApi = typeof api;
