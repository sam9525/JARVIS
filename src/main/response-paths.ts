// Pulls path-like strings out of a hook's `tool_response`, whose shape varies
// by tool and by Grep's output_mode and is not a stable contract (see
// docs/tech-spec.md's tool_response note). So: walk whatever arrives, take
// anything that looks like a path, and let the caller's workspace
// normalization reject the rest. Unknown shape → [], never a throw.

const MAX_DEPTH = 6; // deep enough for {mode, results:[{file:...}]}, shallow enough to always terminate

// A path needs a separator or a file extension. "Found 3 files" has neither.
const PATH_LIKE = /[\\/]|\.[a-z0-9]+$/i;

// Grep's content mode emits "path:line:the matched text". Cut at the first
// ":<digits>:" — a Windows drive letter ("D:\") never matches that shape.
function stripLineSuffix(line: string): string {
  const m = /^(.*?):\d+:/.exec(line);
  return m ? m[1] : line;
}

function walk(value: unknown, depth: number, out: string[]): void {
  if (depth > MAX_DEPTH) return;
  if (typeof value === "string") {
    for (const raw of value.split(/\r?\n/)) {
      const line = stripLineSuffix(raw).trim();
      if (line && PATH_LIKE.test(line)) out.push(line);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) walk(item, depth + 1, out);
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const item of Object.values(value)) walk(item, depth + 1, out);
  }
}

export function extractPaths(resp: unknown): string[] {
  const out: string[] = [];
  walk(resp, 0, out);
  return out;
}
