import { MAX_SESSIONS } from "../../shared/session-key";
import type { AgentId } from "../../shared/types";

export type NoticeAction = { label: string; run: () => void };
// absent means the notice line's amber
export type NoticeTone = "neutral";

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
    .then(({ ok, kept, dirty, damaged }) => {
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
      if (damaged) deps.notify(`Linked folder lost files: ${damaged}`);
    })
    .catch((err) => deps.notify(`Could not close the session: ${err}`));
}

/**
 * Opens the owner's next numbered session and selects its tab. Without an
 * agent the launch runs Claude.
 */
export function openSessionTab(
  ownerId: string,
  size: { cols: number; rows: number },
  deps: {
    select(key: string): void;
    notify(text: string, action?: NoticeAction, tone?: NoticeTone): void;
  },
  agent?: AgentId,
): Promise<void> {
  const launched = agent
    ? window.jarvis.ptyLaunch(
        ownerId,
        null,
        size.cols,
        size.rows,
        false,
        undefined,
        agent,
      )
    : window.jarvis.ptyLaunch(ownerId, null, size.cols, size.rows);
  return launched
    .then((r) => {
      if (r.ok && r.key) return deps.select(r.key);
      // a missing CLI is a fact to read, not a fault, so it reads neutral
      if (r.error === "Codex not found")
        return deps.notify(r.error, undefined, "neutral");
      deps.notify(
        r.error === "cap"
          ? `${MAX_SESSIONS} sessions are already open`
          : `Could not open a session${r.error ? `: ${r.error}` : ""}`,
      );
    })
    .catch((err) => deps.notify(`Could not open a session: ${err}`));
}
