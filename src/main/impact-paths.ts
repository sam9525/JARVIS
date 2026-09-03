import { MATCH_CAP } from "./event-mapper";

export interface ImpactHit {
  /** repo-relative POSIX, as gitnexus reports it */
  path: string;
  /** 0 = the target itself, 1..n = hops out */
  depth: number;
}

const MAX_DEPTH = 6; // deep enough for {content:[{text}]}, shallow enough to terminate

interface ImpactShape {
  target?: { filePath?: unknown };
  byDepth?: Record<string, unknown>;
}

const isShape = (v: unknown): v is ImpactShape =>
  v !== null &&
  typeof v === "object" &&
  ("byDepth" in (v as object) || "target" in (v as object));

// The response may arrive as the object itself or as JSON inside an MCP text
// content block. Walk for the first thing that looks like an impact result,
// rather than hard-coding either wrapper.
function findShape(v: unknown, depth: number): ImpactShape | null {
  if (depth > MAX_DEPTH) return null;
  if (typeof v === "string") {
    try {
      const parsed: unknown = JSON.parse(v);
      return isShape(parsed) ? parsed : null;
    } catch {
      return null; // an ordinary string, not a payload
    }
  }
  if (isShape(v)) return v;
  if (Array.isArray(v)) {
    for (const item of v) {
      const found = findShape(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (v !== null && typeof v === "object") {
    for (const item of Object.values(v)) {
      const found = findShape(item, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

/**
 * The blast radius of one gitnexus `impact` call, as paths with hop counts.
 *
 * Not `extractPaths`: that walker splits strings on newlines and would return
 * `"filePath": "src/renderer/App.tsx",` — the whole line — out of a
 * pretty-printed response. It also discards structure, and depth is structure.
 *
 * Unparseable input yields [], never a throw — the same contract extractPaths
 * already holds.
 */
export function extractImpact(resp: unknown): ImpactHit[] {
  const shape = findShape(resp, 0);
  if (!shape) return [];

  // smallest depth wins: a file reachable at both 1 and 3 is a depth-1 problem
  const best = new Map<string, number>();
  const consider = (path: unknown, depth: number) => {
    if (typeof path !== "string" || !path) return;
    const prev = best.get(path);
    if (prev === undefined || depth < prev) best.set(path, depth);
  };

  consider(shape.target?.filePath, 0);
  const byDepth = shape.byDepth;
  if (byDepth !== null && typeof byDepth === "object") {
    for (const [key, list] of Object.entries(byDepth)) {
      const depth = Number(key);
      if (!Number.isFinite(depth) || !Array.isArray(list)) continue;
      for (const entry of list) {
        if (entry === null || typeof entry !== "object") continue;
        consider((entry as Record<string, unknown>).filePath, depth);
      }
    }
  }

  // ascending depth, so the cap drops the far edge of the radius rather than
  // a random slice
  return [...best.entries()]
    .map(([path, depth]) => ({ path, depth }))
    .sort((a, b) => a.depth - b.depth)
    .slice(0, MATCH_CAP);
}
