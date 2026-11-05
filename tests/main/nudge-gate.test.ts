import { describe, expect, it, vi } from "vitest";
import { createNudgeGate } from "../../src/main/nudge-gate";

describe("nudge gate", () => {
  it("types at once while no prompt is open", () => {
    const type = vi.fn();
    createNudgeGate(() => false, type).nudge();
    expect(type).toHaveBeenCalledTimes(1);
  });

  it("holds the nudge until the prompt closes, then types it once", () => {
    const type = vi.fn();
    let open = true;
    const gate = createNudgeGate(() => open, type);
    gate.nudge();
    gate.nudge();
    gate.statusChanged();
    expect(type).not.toHaveBeenCalled();
    open = false;
    gate.statusChanged();
    gate.statusChanged();
    expect(type).toHaveBeenCalledTimes(1);
  });
});
