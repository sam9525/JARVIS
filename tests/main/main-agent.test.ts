import { describe, expect, it } from "vitest";
import {
  MAIN_AGENT_MODEL,
  MAIN_AGENT_NAME,
  mainAgentWorkspace,
  withMainAgent,
} from "../../src/main/main-agent";
import type { Workspace } from "../../src/shared/types";

const repo: Workspace = {
  id: "d:/data/program/jarvis",
  name: "JARVIS",
  rootPath: "D:\\data\\Program\\JARVIS",
  kind: "code",
  sourceId: "gitnexus",
  isSelf: true, // what boot used to set — this plan moves it
};

const vault: Workspace = {
  id: "d:/vault",
  name: "vault",
  rootPath: "D:\\vault",
  kind: "vault",
  sourceId: "vault",
};

describe("mainAgentWorkspace", () => {
  it("is a vault-kind workspace so the empty graph never offers indexing", () => {
    const ws = mainAgentWorkspace("D:\\userData\\main-agent");
    expect(ws.kind).toBe("vault");
    expect(ws.sourceId).toBe("unknown");
    expect(ws.name).toBe(MAIN_AGENT_NAME);
    expect(ws.isSelf).toBe(true);
  });

  it("normalizes its id the way every other workspace id is normalized", () => {
    const ws = mainAgentWorkspace("D:\\userData\\Main-Agent");
    expect(ws.id).toBe("d:/userdata/main-agent");
    expect(ws.rootPath).toBe("D:\\userData\\Main-Agent");
  });

  it("launches on sonnet", () => {
    expect(MAIN_AGENT_MODEL).toBe("sonnet");
  });
});

describe("withMainAgent", () => {
  it("appends the main agent and leaves the vault first", () => {
    const list = withMainAgent(
      [vault, repo],
      mainAgentWorkspace("D:\\userData\\main-agent"),
    );
    expect(list.map((w) => w.name)).toEqual(["vault", "JARVIS", "Main Agent"]);
  });

  it("makes the main agent the only isSelf workspace", () => {
    const list = withMainAgent(
      [vault, repo],
      mainAgentWorkspace("D:\\userData\\main-agent"),
    );
    expect(list.filter((w) => w.isSelf).map((w) => w.name)).toEqual([
      "Main Agent",
    ]);
  });

  it("does not mutate the workspaces it was handed", () => {
    const input = [vault, repo];
    withMainAgent(input, mainAgentWorkspace("D:\\userData\\main-agent"));
    expect(repo.isSelf).toBe(true);
    expect(input).toHaveLength(2);
  });
});
