import type { ScreenEntry } from "../shared/screen-types";

export const COMMAND_DEADLINE_MS = 30_000;

export function commandWord(prompt: string): string | null {
  const match = /^\s*(\/\S+)/.exec(prompt);
  return match ? match[1] : null;
}

const showsCommand = (entry: ScreenEntry, word: string): boolean => {
  if (entry.kind !== "prompt" && entry.kind !== "notice") return false;
  const text = entry.text.trim();
  return (
    text === word || (text.startsWith(word) && /\s/.test(text[word.length]))
  );
};

const clearsMark = (entry: ScreenEntry): boolean =>
  entry.kind === "prompt" ||
  (entry.kind === "notice" && entry.text.trim().startsWith("/"));

interface Waiter {
  word: string;
  done: (confirmed: boolean) => void;
}

export function createCommandWait(deadlineMs: number = COMMAND_DEADLINE_MS) {
  const waiters = new Map<string, Waiter>();
  const unconfirmedKeys = new Set<string>();

  const settleWaiter = (key: string, confirmed: boolean) =>
    waiters.get(key)?.done(confirmed);

  return {
    // Registers synchronously so a transcript line that lands right after the
    // write cannot beat the waiter.
    expect(key: string, word: string): Promise<boolean> {
      settleWaiter(key, false);
      return new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => waiter.done(false), deadlineMs);
        const waiter: Waiter = {
          word,
          done: (confirmed) => {
            clearTimeout(timer);
            if (waiters.get(key) === waiter) waiters.delete(key);
            resolve(confirmed);
          },
        };
        waiters.set(key, waiter);
      });
    },

    delivered(key: string): void {
      unconfirmedKeys.add(key);
    },

    // A turn ran, so the prompt was consumed even when its transcript line is
    // an attachment the parser skips. An open waiter still waits for its line.
    ran(key: string): void {
      unconfirmedKeys.delete(key);
    },

    seen(key: string, entries: ScreenEntry[], reset: boolean): void {
      if (reset) {
        unconfirmedKeys.delete(key);
        settleWaiter(key, true);
        return;
      }
      if (entries.some(clearsMark)) unconfirmedKeys.delete(key);
      const waiter = waiters.get(key);
      if (waiter && entries.some((entry) => showsCommand(entry, waiter.word)))
        waiter.done(true);
    },

    unconfirmed(key: string): boolean {
      return unconfirmedKeys.has(key);
    },

    forget(key: string): void {
      unconfirmedKeys.delete(key);
      settleWaiter(key, false);
    },
  };
}
