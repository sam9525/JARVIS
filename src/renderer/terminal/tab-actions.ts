import { MAX_SESSIONS } from "../../shared/session-key";

export type NoticeAction = { label: string; run: () => void };

/**
 * Ends a tab's session. The panel moves off the tab before its terminal is
 * freed; a worktree left on disk is named through `notify`. A worktree holding
 * work stays open unless `force` is set; the notice then offers to force it.
 */
export function closeSessionTab(
  key: string,
  deps: {
    deselect(key: string): void;
    dispose(key: string): void;
    notify(text: string, action?: NoticeAction): void;
  },
  force = false,
): Promise<void> {
  return window.jarvis
    .ptyClose(key, force)
    .then(({ ok, kept, dirty }) => {
      if (dirty)
        return deps.notify(
          `This worktree has ${dirty}. Commit, merge or move them first.`,
          {
            label: "Close anyway",
            run: () => void closeSessionTab(key, deps, true),
          },
        );
      if (!ok) return deps.notify("Could not close the session");
      deps.deselect(key);
      deps.dispose(key);
      if (kept) deps.notify(`Worktree kept: ${kept}`);
    })
    .catch((err) => deps.notify(`Could not close the session: ${err}`));
}

/** Opens the owner's next numbered session and selects its tab. */
export function openSessionTab(
  ownerId: string,
  size: { cols: number; rows: number },
  deps: { select(key: string): void; notify(text: string): void },
): Promise<void> {
  return window.jarvis
    .ptyLaunch(ownerId, null, size.cols, size.rows)
    .then((r) => {
      if (r.ok && r.key) return deps.select(r.key);
      deps.notify(
        r.error === "cap"
          ? `${MAX_SESSIONS} sessions are already open`
          : `Could not open a session${r.error ? `: ${r.error}` : ""}`,
      );
    })
    .catch((err) => deps.notify(`Could not open a session: ${err}`));
}
