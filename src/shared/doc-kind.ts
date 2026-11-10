export type DocKind = "spec" | "plan";

// Lives in shared because the renderer imports it and main/ask-mapper.ts
// pulls in node:fs through workspaces.
export function docKindOf(header: string): DocKind | null {
  const match = /^(spec|plan)( gate)?$/.exec(header.trim().toLowerCase());
  return match ? (match[1] as DocKind) : null;
}
