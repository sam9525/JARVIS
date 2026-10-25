import { MAIN_LABEL, sessionKey, shownName } from "../../shared/session-key";
import type {
  SessionStatus,
  StatusKind,
  Workspace,
  WorkspaceStatus,
} from "../../shared/types";

export type SessionTab = {
  key: string;
  label: string;
  kind: StatusKind;
  workspaceId: string;
  // the panel owner's main-folder session: always a tab, never closable
  main?: boolean;
  hint?: string;
};

function sessionsOf(
  workspaceId: string,
  statuses: WorkspaceStatus[],
): SessionStatus[] {
  return statuses.find((s) => s.workspaceId === workspaceId)?.sessions ?? [];
}

function mainTab(
  ws: Workspace,
  label: string,
  statuses: WorkspaceStatus[],
): SessionTab {
  const key = sessionKey(ws.id, MAIN_LABEL);
  const kind =
    sessionsOf(ws.id, statuses).find((s) => s.key === key)?.kind ?? "none";
  return { key, label, kind, workspaceId: ws.id, main: true };
}

/** Home: the main agent, then Scratch's live sessions numbered by position. */
export function homeTabs(
  orchestrator: Workspace,
  scratch: Workspace | undefined,
  statuses: WorkspaceStatus[],
): SessionTab[] {
  const tabs = [mainTab(orchestrator, "MAIN", statuses)];
  if (!scratch) return tabs;
  const live = sessionsOf(scratch.id, statuses).filter((s) => s.live);
  return [
    ...tabs,
    ...live.map((s, i) => ({
      key: s.key,
      label: live.length === 1 ? "SCRATCH" : `SCRATCH ${i + 1}`,
      kind: s.kind,
      workspaceId: scratch.id,
    })),
  ];
}

/**
 * A project: its main-folder session, live or not, so the launch button stays
 * reachable while worktree sessions run, then every other live session.
 */
export function projectTabs(
  ws: Workspace,
  statuses: WorkspaceStatus[],
): SessionTab[] {
  const main = mainTab(ws, MAIN_LABEL, statuses);
  const others = sessionsOf(ws.id, statuses).filter(
    (s) => s.live && s.key !== main.key,
  );
  return [
    main,
    ...others.map((s) => ({
      key: s.key,
      label: shownName(s, others),
      kind: s.kind,
      workspaceId: ws.id,
      // a code folder that is not a git repo gets no worktree, so this session
      // edits the same files as main
      ...(s.worktree
        ? { hint: "worktree" }
        : ws.kind === "code"
          ? { hint: "shared folder" }
          : {}),
    })),
  ];
}

/** The selected tab, or the first one once the selected session has ended. */
export function pickTab(
  tabs: SessionTab[],
  selected: string | undefined,
): SessionTab {
  return tabs.find((t) => t.key === selected) ?? tabs[0];
}

const URGENCY: Partial<Record<StatusKind, number>> = {
  asking: 0,
  blocked: 0,
  working: 1,
};

/**
 * The tab a card or ring tile shows: the owner's selection while it is a tab,
 * else the most urgent session, so a card whose only working session is a
 * worktree lights that session. Earlier tabs win a tie, which keeps main.
 */
export function cardTab(
  tabs: SessionTab[],
  selected: string | undefined,
): SessionTab {
  const chosen = tabs.find((t) => t.key === selected);
  if (chosen) return chosen;
  const rank = (t: SessionTab) => URGENCY[t.kind] ?? 2;
  return tabs.reduce((best, t) => (rank(t) < rank(best) ? t : best));
}

// `seen` turns true once the key has been one of the owner's tabs. A tab just
// opened with `+` is selected before its status row reports it live, so an
// unseen key is kept; a seen key that is no longer a tab has ended.
export type TabSelection = { key: string; seen: boolean };

/**
 * Drops each owner's selection once its session has ended, so a later session
 * reusing the label is not selected for the user. `tabsFor` returns null for an
 * owner that no longer exists. Returns the same map when nothing changed.
 */
export function pruneSelections(
  selected: Map<string, TabSelection>,
  tabsFor: (ownerId: string) => SessionTab[] | null,
): Map<string, TabSelection> {
  let next: Map<string, TabSelection> | null = null;
  for (const [ownerId, sel] of selected) {
    const isTab = tabsFor(ownerId)?.some((t) => t.key === sel.key) ?? false;
    if (isTab === sel.seen) continue;
    next ??= new Map(selected);
    if (isTab) next.set(ownerId, { key: sel.key, seen: true });
    else next.delete(ownerId);
  }
  return next ?? selected;
}
