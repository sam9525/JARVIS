import type {
  StatusKind,
  Workspace,
  WorkspaceKind,
  WorkspaceStatus,
} from "../shared/types";

// The orchestrator feature's logic, pure over injected deps — no HTTP, no
// Electron. http-listener exposes it on /orchestrate/*; index.ts wires the
// real workspaces/status/pty in.
export interface OrchestrateDeps {
  getWorkspaces: () => Workspace[];
  snapshot: () => WorkspaceStatus[];
  hasPty: (workspaceId: string) => boolean;
  write: (workspaceId: string, data: string) => boolean;
  markDelegated: (workspaceId: string, by: string) => void;
}

// one jarvis_list row per workspace
export interface FleetEntry {
  name: string;
  kind: WorkspaceKind;
  status: StatusKind;
  call: string;
  message: string;
  live: boolean;
  delegatedBy: string;
}

export type SendResult = { ok: true } | { ok: false; error: string };

export function createOrchestrator(deps: OrchestrateDeps) {
  return {
    list(): FleetEntry[] {
      const byId = new Map(deps.snapshot().map((s) => [s.workspaceId, s]));
      return deps.getWorkspaces().map((w) => {
        const s = byId.get(w.id);
        return {
          name: w.name,
          kind: w.kind,
          status: s?.kind ?? "none",
          call: s?.call ?? "",
          message: s?.message ?? "",
          live: deps.hasPty(w.id),
          delegatedBy: s?.delegatedBy ?? "",
        };
      });
    },

    send(target: string, prompt: string): SendResult {
      const all = deps.getWorkspaces();
      const q = String(target ?? "")
        .trim()
        .toLowerCase();
      const ws = all.find((w) => w.name.toLowerCase() === q || w.id === q);
      if (!ws) {
        const names = all.map((w) => w.name).join(", ");
        return {
          ok: false,
          error: `no workspace "${target}" — workspaces: ${names}`,
        };
      }
      // self-send is the one loop the one-orchestrator topology can't rule out
      if (ws.kind === "vault") {
        return {
          ok: false,
          error: `refused: ${ws.name} is the orchestrator itself`,
        };
      }
      if (!String(prompt ?? "").trim()) {
        return { ok: false, error: "empty prompt" };
      }
      if (!deps.hasPty(ws.id)) {
        return {
          ok: false,
          error: `${ws.name} has no session — launch it first`,
        };
      }
      const by = all.find((w) => w.kind === "vault")?.name ?? "vault";
      deps.markDelegated(ws.id, by);
      // "\r" submits — exactly what the inbox's sendReply appends
      deps.write(ws.id, prompt + "\r");
      return { ok: true };
    },
  };
}

export type Orchestrator = ReturnType<typeof createOrchestrator>;
