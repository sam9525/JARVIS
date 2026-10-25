import { describe, it, expect } from "vitest";
import {
  MAIN_LABEL,
  MAX_SESSIONS,
  sessionKey,
  parseSessionKey,
  cleanLabel,
  nextLabel,
  shownName,
} from "../../src/shared/session-key";

describe("session key constants", () => {
  it("names the main label and caps sessions per workspace", () => {
    expect(MAIN_LABEL).toBe("main");
    expect(MAX_SESSIONS).toBe(4);
  });
});

describe("sessionKey", () => {
  it("keeps the bare workspace id for the main session", () => {
    expect(sessionKey("d:/repo", "main")).toBe("d:/repo");
  });

  it("appends the label after a # for other sessions", () => {
    expect(sessionKey("d:/repo", "2")).toBe("d:/repo#2");
  });
});

describe("parseSessionKey", () => {
  it("splits a labelled key into workspace id and label", () => {
    expect(parseSessionKey("d:/repo#2")).toEqual({
      workspaceId: "d:/repo",
      label: "2",
    });
  });

  it("reads a bare key as the main session", () => {
    expect(parseSessionKey("d:/repo")).toEqual({
      workspaceId: "d:/repo",
      label: "main",
    });
  });

  it("splits at the last # so the workspace id may contain one", () => {
    expect(parseSessionKey("d:/a#b#c")).toEqual({
      workspaceId: "d:/a#b",
      label: "c",
    });
  });

  it("reads a main key whose workspace id holds a # as the main session", () => {
    expect(parseSessionKey("d:/code/c#-app", ["d:/code/c#-app"])).toEqual({
      workspaceId: "d:/code/c#-app",
      label: "main",
    });
  });

  it("splits a labelled key whose workspace id holds a # at the last #", () => {
    expect(parseSessionKey("d:/code/c#-app#2", ["d:/code/c#-app"])).toEqual({
      workspaceId: "d:/code/c#-app",
      label: "2",
    });
  });

  it("round-trips a main key through sessionKey for a workspace id holding a #", () => {
    const workspaceId = "d:/code/c#-app";
    expect(
      parseSessionKey(sessionKey(workspaceId, "main"), [workspaceId]),
    ).toEqual({ workspaceId, label: "main" });
  });
});

describe("cleanLabel", () => {
  it("replaces characters outside [A-Za-z0-9 -] with -", () => {
    expect(cleanLabel("My_Project.v2")).toBe("My-Project-v2");
  });

  it("cuts the label to 20 characters", () => {
    expect(cleanLabel("a".repeat(30))).toBe("a".repeat(20));
  });

  it("returns an empty string for an all-blank label", () => {
    expect(cleanLabel("   ")).toBe("");
  });

  it("drops a trailing space left by the 20-character cut", () => {
    expect(cleanLabel("a".repeat(19) + " b")).toBe("a".repeat(19));
  });
});

describe("nextLabel", () => {
  it("starts at first when nothing is taken", () => {
    expect(nextLabel([], [])).toBe("first");
  });

  it("skips words taken by sessions or folders", () => {
    expect(nextLabel(["main", "first"], ["second"])).toBe("third");
  });

  it("fills the lowest gap", () => {
    expect(nextLabel(["first", "third"], [])).toBe("second");
  });

  it("falls back to numbers past tenth", () => {
    const all = [
      "first",
      "second",
      "third",
      "fourth",
      "fifth",
      "sixth",
      "seventh",
      "eighth",
      "ninth",
      "tenth",
    ];
    expect(nextLabel(all, ["1"])).toBe("2");
  });
});

describe("shownName", () => {
  const a = { label: "first", topic: "review" };

  it("falls back to the label without a topic", () => {
    expect(shownName({ label: "first" }, [])).toBe("first");
  });

  it("shows a unique topic alone", () => {
    expect(shownName(a, [a, { label: "second", topic: "build" }])).toBe(
      "review",
    );
  });

  it("appends the label when a sibling shares the topic", () => {
    expect(shownName(a, [a, { label: "second", topic: "review" }])).toBe(
      "review first",
    );
  });

  it("appends the label when a sibling is labelled with the topic", () => {
    expect(shownName(a, [a, { label: "review" }])).toBe("review first");
  });
});
