export type AgeTier = "fresh" | "week" | "stale";

const DAY_MS = 86_400_000;

// Whole local calendar days: Date.UTC on both sides keeps a DST hour from
// turning 31 days into 30.98.
export function taskAge(
  created: string | null,
  now: Date,
): { label: string; tier: AgeTier } | null {
  if (!created) return null;
  const [y, m, d] = created.split("-").map(Number);
  const days = Math.max(
    0,
    Math.round(
      (Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) -
        Date.UTC(y, m - 1, d)) /
        DAY_MS,
    ),
  );
  const tier = days < 3 ? "fresh" : days < 14 ? "week" : "stale";
  return { label: days === 0 ? "today" : `${days}d`, tier };
}
