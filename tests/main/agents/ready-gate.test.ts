import { describe, expect, it } from "vitest";
import { createReadyGate } from "../../../src/main/agents/ready-gate";

describe("ready gate", () => {
  it("starts a session at starting", () => {
    const gate = createReadyGate();
    gate.open("k");
    expect(gate.state("k")).toBe("starting");
  });

  it("the first hook makes it ready", () => {
    const gate = createReadyGate();
    gate.open("k");
    gate.note("k", "SessionStart");
    expect(gate.state("k")).toBe("ready");
  });

  it("a prompt moves ready to used, and used stays used", () => {
    const gate = createReadyGate();
    gate.open("k");
    gate.note("k", "SessionStart");
    gate.note("k", "PreToolUse");
    expect(gate.state("k")).toBe("ready");
    gate.note("k", "UserPromptSubmit");
    expect(gate.state("k")).toBe("used");
    gate.note("k", "PreToolUse");
    expect(gate.state("k")).toBe("used");
  });

  it("a prompt as the first hook makes it used", () => {
    const gate = createReadyGate();
    gate.open("k");
    gate.note("k", "UserPromptSubmit");
    expect(gate.state("k")).toBe("used");
  });

  it("an Interrupt moves used back to ready", () => {
    const gate = createReadyGate();
    gate.open("k");
    gate.note("k", "UserPromptSubmit");
    gate.note("k", "Interrupt");
    expect(gate.state("k")).toBe("ready");
  });

  it("an Interrupt as the first hook makes it ready", () => {
    const gate = createReadyGate();
    gate.open("k");
    gate.note("k", "Interrupt");
    expect(gate.state("k")).toBe("ready");
  });

  it("open resets a known key to starting", () => {
    const gate = createReadyGate();
    gate.open("k");
    gate.note("k", "SessionStart");
    gate.open("k");
    expect(gate.state("k")).toBe("starting");
  });

  it("an unknown key has no state", () => {
    const gate = createReadyGate();
    expect(gate.state("unknown")).toBeUndefined();
  });

  it("note on a never-opened key leaves it unknown", () => {
    const gate = createReadyGate();
    gate.note("k", "SessionStart");
    expect(gate.state("k")).toBeUndefined();
  });

  it("forget clears the state", () => {
    const gate = createReadyGate();
    gate.open("k");
    gate.forget("k");
    expect(gate.state("k")).toBeUndefined();
  });
});
