import { watch, type FSWatcher } from "node:fs";
import { open, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import type { ScreenEntry } from "../shared/screen-types";
import { parseTranscriptLine } from "./transcript-parse";

export type FeedEmit = (
  key: string,
  entries: ScreenEntry[],
  reset: boolean,
) => void;
type ReadFrom = (path: string, offset: number) => Promise<string>;

interface Followed {
  path: string;
  offset: number;
  rest: string;
  entries: ScreenEntry[];
  watcher: FSWatcher | null;
  chain: Promise<void>;
  resetPending: boolean;
}

async function readFileFrom(path: string, offset: number): Promise<string> {
  const handle = await open(path, "r");
  try {
    const { size } = await handle.stat();
    if (size <= offset) return "";
    const buffer = Buffer.alloc(size - offset);
    await handle.read(buffer, 0, buffer.length, offset);
    return buffer.toString("utf8");
  } finally {
    await handle.close();
  }
}

export function createTranscriptFeed(
  emit: FeedEmit,
  readFrom: ReadFrom = readFileFrom,
) {
  const followed = new Map<string, Followed>();

  // Watching is best-effort: a missing or deleted file only means no pokes arrive.
  function watchPath(key: string, state: Followed): void {
    try {
      state.watcher = watch(state.path, () => void poke(key));
      state.watcher.on("error", () => closeWatcher(state));
    } catch {
      state.watcher = null;
    }
  }

  function closeWatcher(state: Followed): void {
    state.watcher?.close();
    state.watcher = null;
  }

  async function readOnce(key: string, state: Followed): Promise<void> {
    let text: string;
    try {
      text = await readFrom(state.path, state.offset);
    } catch {
      return;
    }
    if (followed.get(key) !== state) return;
    // The offset counts bytes; `rest` is carried as text and already counted.
    state.offset += Buffer.byteLength(text);
    const joined = state.rest + text;
    const cut = joined.lastIndexOf("\n");
    state.rest = joined.slice(cut + 1);
    const entries = joined
      .slice(0, cut + 1)
      .split("\n")
      .filter((line) => line !== "")
      .flatMap(parseTranscriptLine);
    const reset = state.resetPending;
    if (entries.length === 0 && !reset) return;
    state.resetPending = false;
    state.entries.push(...entries);
    emit(key, entries, reset);
    if (!state.watcher) watchPath(key, state);
  }

  function poke(key: string): Promise<void> {
    const state = followed.get(key);
    if (!state) return Promise.resolve();
    state.chain = state.chain.then(() => readOnce(key, state));
    return state.chain;
  }

  async function follow(key: string, path: string): Promise<void> {
    const current = followed.get(key);
    if (current?.path === path) return poke(key);
    if (current) closeWatcher(current);
    const state: Followed = {
      path,
      offset: 0,
      rest: "",
      entries: [],
      watcher: null,
      chain: Promise.resolve(),
      resetPending: true,
    };
    followed.set(key, state);
    watchPath(key, state);
    return poke(key);
  }

  function stop(key: string): void {
    const state = followed.get(key);
    if (state) closeWatcher(state);
    followed.delete(key);
  }

  return {
    follow,
    poke,
    snapshot: (key: string): ScreenEntry[] => [
      ...(followed.get(key)?.entries ?? []),
    ],
    stop,
    stopAll: (): void => {
      for (const key of [...followed.keys()]) stop(key);
    },
  };
}

export async function newestTranscript(dir: string): Promise<string | null> {
  let names: string[];
  try {
    names = (await readdir(dir)).filter((name) => name.endsWith(".jsonl"));
  } catch {
    return null;
  }
  let best: { path: string; mtime: number } | null = null;
  for (const name of names) {
    const path = join(dir, name);
    try {
      const { mtimeMs } = await stat(path);
      if (!best || mtimeMs > best.mtime) best = { path, mtime: mtimeMs };
    } catch {
      continue;
    }
  }
  return best?.path ?? null;
}
