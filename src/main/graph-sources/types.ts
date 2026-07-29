import type { VaultGraph, Workspace } from "../../shared/types";

export interface GraphSource {
  // "vault" | "gitnexus" | … — the renderer reads SOURCE_LABELS[id] for the
  // caption, so the label deliberately does not live here too
  id: string;
  detect(ws: Workspace): Promise<boolean>; // cheap fs probe — never expensive
  load(ws: Workspace): Promise<VaultGraph>;
  loadSymbols?(ws: Workspace): Promise<VaultGraph>; // symbol/concept level
  index?(rootPath: string): Promise<void>; // gitnexus analyze
  stale?(rootPath: string): Promise<boolean>; // index behind repo HEAD
  reindexCommand?: string; // what the stale button types into the terminal
}
