import { describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  AGENT_GUIDE,
  FINISH_NUDGE,
  ensureMainAgent,
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

const tmpRoot = async () =>
  path.join(
    await fs.mkdtemp(path.join(os.tmpdir(), "jarvis-agent-")),
    "main-agent",
  );

describe("ensureMainAgent", () => {
  it("creates the folder and writes the standing instruction", async () => {
    const root = await tmpRoot();
    await ensureMainAgent(root);
    const guide = await fs.readFile(path.join(root, "CLAUDE.md"), "utf8");
    expect(guide).toBe(AGENT_GUIDE);
  });

  it("tells the agent to re-arm the watch and to keep the summary spoken", () => {
    expect(AGENT_GUIDE).toContain("jarvis_watch");
    expect(AGENT_GUIDE).toContain("jarvis_say");
  });

  it("leaves an edited guide alone — the user owns the file after first boot", async () => {
    const root = await tmpRoot();
    await ensureMainAgent(root);
    const file = path.join(root, "CLAUDE.md");
    await fs.writeFile(file, "# mine\n", "utf8");
    await ensureMainAgent(root);
    expect(await fs.readFile(file, "utf8")).toBe("# mine\n");
  });

  it("is safe to call on a folder that already exists", async () => {
    const root = await tmpRoot();
    await ensureMainAgent(root);
    await expect(ensureMainAgent(root)).resolves.toBeUndefined();
  });

  it("logs non-EEXIST errors but does not reject", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(vi.fn());
    const writeFileSpy = vi
      .spyOn(fs, "writeFile")
      .mockRejectedValueOnce(
        Object.assign(new Error("Permission denied"), { code: "EACCES" }),
      );

    const root = await tmpRoot();
    await expect(ensureMainAgent(root)).resolves.toBeUndefined();

    expect(warnSpy).toHaveBeenCalledWith(
      "[jarvis] failed to write main-agent guide:",
      expect.any(Error),
    );

    warnSpy.mockRestore();
    writeFileSpy.mockRestore();
  });
});

describe("FINISH_NUDGE", () => {
  it("names no workspace and carries no message — the agent reads the fleet itself", () => {
    expect(FINISH_NUDGE).toContain("jarvis_list");
    expect(FINISH_NUDGE).not.toContain("{");
  });

  it("fits on one line, since it is typed into a TUI composer", () => {
    expect(FINISH_NUDGE).not.toContain("\n");
  });

  // the summary is heard, not read: a listener cannot skim, so length is the
  // whole design constraint
  it("asks for the fewest words and rules out the shapes that pad speech", () => {
    expect(FINISH_NUDGE).toContain("as few words as");
    for (const banned of ["preamble", "list", "file names", "markdown"]) {
      expect(FINISH_NUDGE).toContain(banned);
    }
  });
});

describe("AGENT_GUIDE describes the nudge, not a watch loop", () => {
  it("tells the agent it is started by the app rather than by polling", () => {
    expect(AGENT_GUIDE).toContain("jarvis_list");
    expect(AGENT_GUIDE).toContain("do not park");
  });

  it("holds the guide and the nudge to the same fewest-words brief", () => {
    expect(AGENT_GUIDE).toContain("as few words as possible");
    expect(AGENT_GUIDE).toContain("Someone is listening, not reading");
  });
});
