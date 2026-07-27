import { describe, it, expect } from "vitest";
import { createOrchestrator } from "../../src/main/orchestrate";
import type { Workspace, WorkspaceStatus } from "../../src/shared/types";

const workspaces: Workspace[] = [
  { id: "d:/vault", name: "JARVIS", rootPath: "D:\\vault", kind: "vault" },
  { id: "d:/aero", name: "AeroGraph", rootPath: "D:\\aero", kind: "code" },
  { id: "d:/fin", name: "FinPulse", rootPath: "D:\\fin", kind: "code" },
];

const status = (over: Partial<WorkspaceStatus>): WorkspaceStatus => ({
  workspaceId: "d:/aero",
  kind: "running",
  call: "Edit(vite.config.ts)",
  since: 0,
  reads: 0,
  edits: 0,
  ...over,
});

function setup(over: {
  statuses?: WorkspaceStatus[];
  live?: string[]; // workspace ids with a PTY
} = {}) {
  const writes: Array<[string, string]> = [];
  const delegated: Array<[string, string]> = [];
  const live = new Set(over.live ?? ["d:/aero"]);
  const orch = createOrchestrator({
    getWorkspaces: () => workspaces,
    snapshot: () => over.statuses ?? [],
    hasPty: (id) => live.has(id),
    write: (id, data) => {
      writes.push([id, data]);
      return true;
    },
    markDelegated: (id, by) => {
      delegated.push([id, by]);
    },
  });
  return { orch, writes, delegated };
}

describe("orchestrate.list", () => {
  it("joins every workspace with its status and liveness", () => {
    const { orch } = setup({
      statuses: [
        status({
          workspaceId: "d:/aero",
          kind: "running",
          call: "Edit(vite.config.ts)",
          message: "hi",
          delegatedBy: "JARVIS",
        }),
      ],
      live: ["d:/aero"],
    });
    const out = orch.list();
    expect(out).toHaveLength(3);
    expect(out[1]).toEqual({
      name: "AeroGraph",
      kind: "code",
      status: "running",
      call: "Edit(vite.config.ts)",
      message: "hi",
      live: true,
      delegatedBy: "JARVIS",
    });
    // a workspace with no status entry and no PTY reads as none / not live
    expect(out[2]).toEqual({
      name: "FinPulse",
      kind: "code",
      status: "none",
      call: "",
      message: "",
      live: false,
      delegatedBy: "",
    });
  });
});

describe("orchestrate.send", () => {
  it("happy path: marks provenance then writes exactly prompt + CR", () => {
    const { orch, writes, delegated } = setup();
    const out = orch.send("AeroGraph", "run the packaging fix");
    expect(out).toEqual({ ok: true });
    expect(delegated).toEqual([["d:/aero", "JARVIS"]]);
    expect(writes).toEqual([["d:/aero", "run the packaging fix\r"]]);
  });

  it("resolves the target name case-insensitively", () => {
    const { orch, writes } = setup();
    expect(orch.send("aerograph", "x").ok).toBe(true);
    expect(writes).toHaveLength(1);
  });

  it("rejects an unknown workspace, listing the valid names", () => {
    const { orch, writes, delegated } = setup();
    const out = orch.send("NopeCorp", "x");
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toContain("AeroGraph");
    expect(writes).toEqual([]);
    expect(delegated).toEqual([]);
  });

  it("rejects a target with no live PTY", () => {
    const { orch, writes, delegated } = setup({ live: [] });
    const out = orch.send("AeroGraph", "x");
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toContain("no session");
    expect(writes).toEqual([]);
    expect(delegated).toEqual([]);
  });

  it("refuses to send to the vault itself", () => {
    const { orch, writes, delegated } = setup({ live: ["d:/vault"] });
    const out = orch.send("JARVIS", "x");
    expect(out.ok).toBe(false);
    expect(writes).toEqual([]);
    expect(delegated).toEqual([]);
  });

  it("rejects an empty prompt", () => {
    const { orch, writes, delegated } = setup();
    const out = orch.send("AeroGraph", "   ");
    expect(out.ok).toBe(false);
    expect(writes).toEqual([]);
    expect(delegated).toEqual([]);
  });
});
