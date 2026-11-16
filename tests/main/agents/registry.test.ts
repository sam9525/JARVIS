import { describe, expect, it } from "vitest";
import { AGENTS, agentById } from "../../../src/main/agents";
import { claudeCommand } from "../../../src/main/agents/claude";

describe("agent registry", () => {
  it("falls back to claude for an unknown or absent id", () => {
    expect(agentById(undefined).id).toBe("claude");
    expect(agentById("nope").id).toBe("claude");
    expect(AGENTS.map((a) => a.id)).toContain("claude");
  });

  it("claude normalize returns the same object in an array", () => {
    const raw = { a: 1 };
    const out = agentById("claude").normalize(raw);
    expect(out).toHaveLength(1);
    expect(out[0]).toBe(raw);
  });

  it("claude command wraps claudeCommand", async () => {
    const cmd = await agentById("claude").command({
      dangerous: true,
      model: "opus",
      resume: false,
      forwardPath: "x",
    });
    expect(cmd).toEqual(claudeCommand(true, "opus", false));
  });

  it("finds codex, which supports only resume", () => {
    const codex = agentById("codex");
    expect(codex.id).toBe("codex");
    const enabled = Object.entries(codex.features)
      .filter(([, on]) => on)
      .map(([name]) => name);
    expect(enabled).toEqual(["resume"]);
  });
});
