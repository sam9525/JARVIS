import type { AgentId, Workspace } from "../../shared/types";
import type { RawHookEvent } from "../event-mapper";
import { claudeAdapter } from "./claude";
import { createCodexAdapter } from "./codex";
import { locateCodex } from "./codex-locate";

export interface AgentFeatures {
  transcript: boolean;
  askPanel: boolean;
  permissionCard: boolean;
  statusLine: boolean;
  slashList: boolean;
  trustCheck: boolean;
  resume: boolean;
}

export interface AgentCommandOpts {
  dangerous: boolean;
  model?: string;
  resume: boolean | string;
  forwardPath: string;
}

export interface AgentAdapter {
  id: AgentId;
  features: AgentFeatures;
  /** null = the program was not found */
  command(
    opts: AgentCommandOpts,
  ): Promise<{ file: string; args: string[] } | null>;
  /** false = the preparation failed (reported as hooksOk) */
  prepare(ctx: {
    cwd: string;
    ws: Workspace;
    forwardPath: string;
    mcpPath: string;
  }): Promise<boolean>;
  normalize(raw: Record<string, unknown>): RawHookEvent[];
}

export const AGENTS: readonly AgentAdapter[] = [
  claudeAdapter,
  createCodexAdapter(locateCodex),
];

export function agentById(id: unknown): AgentAdapter {
  return AGENTS.find((a) => a.id === id) ?? claudeAdapter;
}
