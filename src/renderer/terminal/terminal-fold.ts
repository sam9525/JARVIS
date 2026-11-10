import type { WorkspaceStatus } from "../../shared/types";

export function hasLiveSession(
  statuses: WorkspaceStatus[],
  workspaceId: string,
): boolean {
  return statuses.some(
    (s) => s.workspaceId === workspaceId && s.sessions.some((x) => x.live),
  );
}
