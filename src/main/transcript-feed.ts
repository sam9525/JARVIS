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
type ReadFrom = (path: string, offset: number) => Promise<Buffer>;
type WatchFile = typeof watch;

interface Followed {
  path: string;
  offset: number;
  rest: Buffer;
  entries: ScreenEntry[];
  watcher: FSWatcher | null;
  chain: Promise<void>;
  resetPending: boolean;
  switched: boolean;
}

async function readFileFrom(path: string, offset: number): Promise<Buffer> {
  const handle = await open(path, "r");
  try {
    const { size } = await handle.stat();
    if (size <= offset) return Buffer.alloc(0);
    const buffer = Buffer.alloc(size - offset);
    await handle.read(buffer, 0, buffer.length, offset);
    return buffer;
  } finally {
    await handle.close();
  }
}

export function createTranscriptFeed(
  emit: FeedEmit,
  readFrom: ReadFrom = readFileFrom,
  watchFile: WatchFile = watch,
) {
  const followed = new Map<string, Followed>();

  // Watching is best-effort: a missing or deleted file only means no pokes arrive.
  // Every read retries it, so a file that appears later gets watched.
  function watchPath(key: string, state: Followed): void {
    try {
      state.watcher = watchFile(state.path, () => void poke(key));
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
    if (!state.watcher) watchPath(key, state);
    let chunk: Buffer;
    try {
      chunk = await readFrom(state.path, state.offset);
    } catch {
      // A path switch to a file that is not there yet still clears the old entries.
      if (followed.get(key) === state && state.switched && state.resetPending) {
        state.resetPending = false;
        emit(key, [], true);
      }
      return;
    }
    if (followed.get(key) !== state) return;
    state.offset += chunk.length;
    // Only whole lines are decoded, so a character split across reads stays intact.
    const joined = Buffer.concat([state.rest, chunk]);
    const cut = joined.lastIndexOf(0x0a);
    state.rest = joined.subarray(cut + 1);
    const entries = joined
      .subarray(0, cut + 1)
      .toString("utf8")
      .split("\n")
      .filter((line) => line !== "")
      .flatMap(parseTranscriptLine);
    const reset = state.resetPending;
    if (entries.length === 0 && !reset) return;
    state.resetPending = false;
    state.entries.push(...entries);
    emit(key, entries, reset);
  }

  // A failed read or emit must not leave the chain rejected, or every later poke would fail too.
  function poke(key: string): Promise<void> {
    const state = followed.get(key);
    if (!state) return Promise.resolve();
    state.chain = state.chain
      .then(() => readOnce(key, state))
      .catch(() => undefined);
    return state.chain;
  }

  async function follow(key: string, path: string): Promise<void> {
    const current = followed.get(key);
    if (current?.path === path) return poke(key);
    if (current) closeWatcher(current);
    followed.set(key, {
      path,
      offset: 0,
      rest: Buffer.alloc(0),
      entries: [],
      watcher: null,
      chain: Promise.resolve(),
      resetPending: true,
      switched: current !== undefined,
    });
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
