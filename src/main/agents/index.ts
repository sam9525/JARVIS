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
  hooksRoot: string;
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
    hooksRoot: string;
  }): Promise<boolean>;
  normalize(raw: Record<string, unknown>): RawHookEvent[];
  /** Adds what the hook body lacks; awaited after the reply, before normalize. */
  enrich?(raw: Record<string, unknown>): Promise<Record<string, unknown>>;
  /** The name the ready gate is noted with; absent means raw.hook_event_name. */
  gateEvent?(raw: Record<string, unknown>): string | undefined;
  /** false = the agent will ask its own trust question for this folder. */
  trusted?(cwd: string): Promise<boolean>;
}

export const AGENTS: readonly AgentAdapter[] = [
  claudeAdapter,
  createCodexAdapter(locateCodex),
];

export function agentById(id: unknown): AgentAdapter {
  return AGENTS.find((a) => a.id === id) ?? claudeAdapter;
}
