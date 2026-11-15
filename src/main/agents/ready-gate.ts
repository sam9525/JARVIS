export type ReadyState = "starting" | "ready" | "used";

type Waiter = (ready: boolean) => void;

export function createReadyGate() {
  const states = new Map<string, ReadyState>();
  const waiters = new Map<string, Set<Waiter>>();

  function releaseWaiters(key: string, ready: boolean): void {
    const pending = waiters.get(key);
    waiters.delete(key);
    pending?.forEach((release) => release(ready));
  }

  return {
    open(key: string): void {
      states.set(key, "starting");
    },

    // Any hook proves the session is past the prompts no hook reports.
    note(key: string, hookEventName: string): void {
      const current = states.get(key);
      if (current === undefined || current === "used") return;
      if (hookEventName === "UserPromptSubmit") states.set(key, "used");
      else if (current === "starting") states.set(key, "ready");
      else return;
      releaseWaiters(key, true);
    },

    state(key: string): ReadyState | undefined {
      return states.get(key);
    },

    wait(key: string, ms: number): Promise<boolean> {
      const current = states.get(key);
      if (current === undefined) return Promise.resolve(false);
      if (current !== "starting") return Promise.resolve(true);
      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          waiters.get(key)?.delete(release);
          resolve(false);
        }, ms);
        const release: Waiter = (ready) => {
          clearTimeout(timer);
          resolve(ready);
        };
        const pending = waiters.get(key) ?? new Set<Waiter>();
        pending.add(release);
        waiters.set(key, pending);
      });
    },

    forget(key: string): void {
      states.delete(key);
      releaseWaiters(key, false);
    },
  };
}
