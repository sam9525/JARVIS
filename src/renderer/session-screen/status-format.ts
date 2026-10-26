export function meterTone(pct: number): "accent" | "warm" | "hot" {
  if (pct >= 80) return "hot";
  if (pct >= 50) return "warm";
  return "accent";
}

export function resetIn(resetsAtSec: number, nowMs: number): string {
  const totalMin = Math.floor((resetsAtSec * 1000 - nowMs) / 60000);
  if (totalMin <= 0) return "";
  const days = Math.floor(totalMin / 1440);
  const hours = Math.floor((totalMin % 1440) / 60);
  const mins = totalMin % 60;
  if (days > 0) return `${days}d${hours}h`;
  if (hours > 0) return `${hours}h${mins}m`;
  return `${mins}m`;
}
