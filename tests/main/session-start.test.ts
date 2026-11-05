import { describe, it, expect } from "vitest";
import { mapSessionStart } from "../../src/main/session-start";
import { mapStatusEvent } from "../../src/main/status-mapper";
import { buildWorkspaces } from "../../src/main/workspaces";

const workspaces = buildWorkspaces("D:\\vault", []);
const start = {
  hook_event_name: "SessionStart",
  session_id: "s-new",
  cwd: "D:\\vault",
  transcript_path: "C:\\t\\s-new.jsonl",
  source: "clear",
  jarvis_session: `${workspaces[0].id}#2`,
};

describe("mapSessionStart", () => {
  it("names the session and its new transcript", () => {
    expect(mapSessionStart(start, workspaces)).toEqual({
      sessionKey: `${workspaces[0].id}#2`,
      transcriptPath: "C:\\t\\s-new.jsonl",
      fromApp: true,
    });
  });

  it("marks a claude started by hand as not the app's", () => {
    const hand = { ...start, jarvis_session: undefined };
    expect(mapSessionStart(hand, workspaces)?.fromApp).toBe(false);
  });

  it("ignores other events and payloads without a transcript", () => {
    expect(
      mapSessionStart({ ...start, hook_event_name: "Stop" }, workspaces),
    ).toBeNull();
    expect(
      mapSessionStart({ ...start, transcript_path: undefined }, workspaces),
    ).toBeNull();
    expect(
      mapSessionStart({ ...start, cwd: "E:\\elsewhere" }, workspaces),
    ).toBeNull();
  });

  it("leaves status untouched", () => {
    expect(mapStatusEvent(start, workspaces)).toBeNull();
  });
});
