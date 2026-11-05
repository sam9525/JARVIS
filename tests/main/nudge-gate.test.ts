import { describe, expect, it, vi } from "vitest";
import { createNudgeGate } from "../../src/main/nudge-gate";

describe("nudge gate", () => {
  it("types at once while no prompt is open", () => {
    const type = vi.fn();
    const gate = createNudgeGate(() => false, type);
    gate.nudge("A");
    gate.nudge("B");
    expect(type.mock.calls).toEqual([["A"], ["B"]]);
  });

  it("holds the first text until the prompt closes, then types it once", () => {
    const type = vi.fn();
    let open = true;
    const gate = createNudgeGate(() => open, type);
    gate.nudge("A");
    gate.nudge("B");
    gate.statusChanged();
    expect(type).not.toHaveBeenCalled();
    open = false;
    gate.statusChanged();
    gate.statusChanged();
    expect(type.mock.calls).toEqual([["A"]]);
  });
});
