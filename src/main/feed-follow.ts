import type { StatusEvent } from "../shared/types";

interface FollowTarget {
  follow(key: string, path: string): unknown;
  poke(key: string): unknown;
}

/** A hook event can land after its session was closed; following then would
 * re-create a watcher nothing stops, so only a live PTY's events reach the feed. */
export function feedStatusEvent(
  feed: FollowTarget,
  s: Pick<StatusEvent, "sessionKey" | "transcriptPath">,
  isLive: boolean,
): void {
  if (!isLive) return;
  if (s.transcriptPath) void feed.follow(s.sessionKey, s.transcriptPath);
  else void feed.poke(s.sessionKey);
}
