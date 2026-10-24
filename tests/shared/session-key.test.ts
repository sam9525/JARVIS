import { describe, it, expect } from "vitest";
import {
  MAIN_LABEL,
  MAX_SESSIONS,
  sessionKey,
  parseSessionKey,
  cleanLabel,
  nextLabel,
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
});

describe("nextLabel", () => {
  it("skips numbers taken by sessions or folders", () => {
    expect(nextLabel(["main", "1"], ["2"])).toBe("3");
  });

  it("starts at 1 when nothing is taken", () => {
    expect(nextLabel([], [])).toBe("1");
  });

  it("fills the lowest gap", () => {
    expect(nextLabel(["1", "3"], [])).toBe("2");
  });
});
