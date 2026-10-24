import { MAIN_LABEL, sessionKey } from "../../shared/session-key";
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
  const tabs = [mainTab(orchestrator, "MAIN AGENT", statuses)];
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
      label: s.label,
      kind: s.kind,
      workspaceId: ws.id,
      // a code folder that is not a git repo gets no worktree, so this session
      // edits the same files as main
      ...(ws.kind === "code" && !s.worktree ? { hint: "shared folder" } : {}),
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
