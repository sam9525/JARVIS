import { vaultSource } from "./vault-source";
import { gitnexusSource } from "./gitnexus-source";
import { graphifySource } from "./graphify-source";
import type { GraphSource } from "./types";
import type { Workspace } from "../../shared/types";

export const UNKNOWN_SOURCE_ID = "unknown";

export const SOURCES: GraphSource[] = [
  vaultSource,
  gitnexusSource,
  graphifySource,
];

export function sourceById(id: string): GraphSource | undefined {
  return SOURCES.find((s) => s.id === id);
}

export async function resolveSourceId(
  ws: Workspace,
  sources: GraphSource[] = SOURCES,
): Promise<string> {
  for (const s of sources) {
    if (await s.detect(ws).catch(() => false)) return s.id;
  }
  return UNKNOWN_SOURCE_ID;
}
