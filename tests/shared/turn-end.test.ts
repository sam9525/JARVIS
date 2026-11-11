import { describe, expect, it } from "vitest";
import { displayKind, endLabel, errorLabel } from "../../src/shared/turn-end";

describe("displayKind", () => {
  it("shows an idle question as asking", () => {
    expect(displayKind({ kind: "idle", ended: "question" })).toBe("asking");
  });
  it("shows an idle failure as crashed", () => {
    expect(displayKind({ kind: "idle", ended: "failed" })).toBe("crashed");
  });
  it("keeps idle for a finished turn or no turn end", () => {
    expect(displayKind({ kind: "idle", ended: "finished" })).toBe("idle");
    expect(displayKind({ kind: "idle" })).toBe("idle");
  });
  it("keeps a non-idle kind whatever the turn end", () => {
    expect(displayKind({ kind: "working", ended: "question" })).toBe("working");
  });
});

describe("errorLabel", () => {
  it.each([
    ["rate_limit", "Rate limited"],
    ["overloaded", "Overloaded"],
    ["authentication_failed", "Auth failed"],
    ["oauth_org_not_allowed", "Auth failed"],
    ["billing_error", "Billing error"],
    ["server_error", "Server error"],
    ["max_output_tokens", "Output too long"],
    [undefined, "API error"],
    ["whatever", "API error"],
  ])("maps %s to %s", (error, label) => {
    expect(errorLabel(error)).toBe(label);
  });
});

describe("errorLabel on inherited keys", () => {
  it.each(["constructor", "toString"])("falls back for %s", (key) => {
    expect(errorLabel(key)).toBe("API error");
  });
});

describe("endLabel", () => {
  it("labels each turn end", () => {
    expect(endLabel({ ended: "finished" })).toBe("Finished");
    expect(endLabel({ ended: "question" })).toBe("Asking question");
    expect(endLabel({ ended: "failed", error: "rate_limit" })).toBe(
      "Rate limited",
    );
  });
  it("is null without a turn end", () => {
    expect(endLabel({})).toBeNull();
  });
});
