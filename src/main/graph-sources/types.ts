import type { VaultGraph, Workspace } from "../../shared/types";

export interface GraphSource {
  id: string; // "vault" | "gitnexus" | …
  label: string; // rail caption
  detect(ws: Workspace): Promise<boolean>; // cheap fs probe — never expensive
  load(ws: Workspace): Promise<VaultGraph>;
  index?(rootPath: string): Promise<void>; // gitnexus analyze
  stale?(rootPath: string): Promise<boolean>; // index behind repo HEAD
}
