import { contextBridge, ipcRenderer } from "electron";
import type {
  LineChanges,
  Settings,
  TodoList,
  TodoOp,
  TodoOpResult,
  ToolEvent,
  VaultGraph,
  Workspace,
  WorkspaceStatus,
} from "../shared/types";
import type { AskPrompt } from "./ask-mapper";
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
  onAsk: (cb: (p: AskPrompt) => void) => subscribe<[AskPrompt]>("ask", cb),
  // jarvis_say → main → here. The renderer owns playback, so both mouths and
  // the dedupe against the turn-end message live in one place.
  onSay: (cb: (text: string) => void) => subscribe<[string]>("tts-say", cb),
  // TODO.md: read, one op at a time, a push on every write, and the agent's
  // jarvis_todos asking the panel to open
  getTodos: (): Promise<TodoList> => ipcRenderer.invoke("get-todos"),
  todoOp: (op: TodoOp): Promise<TodoOpResult> =>
    ipcRenderer.invoke("todo-op", op),
  onTodos: (cb: (l: TodoList) => void) => subscribe<[TodoList]>("todos", cb),
  onShowTodos: (cb: () => void) => subscribe<[]>("show-todos", cb),
  readNote: (workspaceId: string, nodeId: string): Promise<string | null> =>
    ipcRenderer.invoke("read-note", workspaceId, nodeId),
  lineChanges: (workspaceId: string, nodeId: string): Promise<LineChanges> =>
    ipcRenderer.invoke("line-changes", workspaceId, nodeId),
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
    model?: string,
  ): Promise<{ ok: boolean; hooksOk: boolean }> =>
    ipcRenderer.invoke("pty-launch", workspaceId, cols, rows, dangerous, model),
  // returns whether a live PTY took the write, so a caller that is not a
  // keyboard (voice) can report a send into a dead session
  ptyInput: (workspaceId: string, data: string): Promise<boolean> =>
    ipcRenderer.invoke("pty-input", workspaceId, data),
  ptyResize: (workspaceId: string, cols: number, rows: number): void => {
    ipcRenderer.send("pty-resize", workspaceId, cols, rows);
  },
  // the key never crosses this bridge — main reads it from .env
  ttsSpeak: (text: string): Promise<Uint8Array<ArrayBuffer> | null> =>
    ipcRenderer.invoke("tts-speak", text),
  ttsVoices: (): Promise<TtsOption[]> => ipcRenderer.invoke("tts-voices"),
  // head models: names in, bytes out — the renderer never sees a disk path
  listHeadModels: (): Promise<string[]> =>
    ipcRenderer.invoke("list-head-models"),
  readHeadModel: (name: string): Promise<Uint8Array | null> =>
    ipcRenderer.invoke("read-head-model", name),
  // `{}` is a cancelled dialog; `error` is a refusal worth showing.
  pickHeadModel: (): Promise<{ name?: string; error?: string }> =>
    ipcRenderer.invoke("pick-head-model"),
  // the daily briefing's notes folder: a path in, a path out — null is off
  getNotesDir: (): Promise<string | null> =>
    ipcRenderer.invoke("get-notes-dir"),
  pickNotesDir: (): Promise<string | null> =>
    ipcRenderer.invoke("pick-notes-dir"),
  clearNotesDir: (): Promise<string | null> =>
    ipcRenderer.invoke("clear-notes-dir"),
  ttsModels: (): Promise<TtsOption[]> => ipcRenderer.invoke("tts-models"),
  onPtyData: (cb: (workspaceId: string, data: string) => void) =>
    subscribe<[string, string]>("pty-data", cb),
  onPtyExit: (cb: (workspaceId: string, exitCode: number) => void) =>
    subscribe<[string, number]>("pty-exit", cb),
};

contextBridge.exposeInMainWorld("jarvis", api);

export type JarvisApi = typeof api;
