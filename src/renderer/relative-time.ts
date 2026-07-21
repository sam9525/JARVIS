// Card timestamps: coarse on purpose. "40s ago" is the useful precision when
// you are deciding which workspace to look at next.
export function relativeTime(since: number, now: number): string {
  if (!since) return "—";
  const ms = Math.max(0, now - since); // a backwards clock reads as "now"
  if (ms < 5000) return "just now";
  if (ms < 60_000) return `${Math.floor(ms / 1000)}s ago`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  return `${Math.floor(ms / 3_600_000)}h ago`;
}
