import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import SessionScreen, {
  KNOWN_GAPS,
} from "../../src/renderer/session-screen/SessionScreen";
import type { ScreenItem } from "../../src/renderer/session-screen/screen-state";
import type { StatusKind } from "../../src/shared/types";

const noop = vi.fn();
const render = (items: ScreenItem[], kind: StatusKind, call = "") =>
  renderToStaticMarkup(
    <SessionScreen
      sessionKey="s"
      items={items}
      status={{ kind, call }}
      onAskAnswer={noop}
      onWrite={noop}
      onShowRaw={noop}
      footer={<div>FOOTER</div>}
    />,
  );

describe("SessionScreen", () => {
  it("renders a not-shown row for an unknown entry", () => {
    const html = render(
      [{ kind: "unknown", id: "u", label: "Hook output" }],
      "idle",
    );
    expect(html).toContain("not shown here");
    expect(html).toContain("open raw terminal");
  });

  it("shows the permission card when blocked", () => {
    const html = render(
      [{ kind: "tool", id: "t", name: "Bash", input: { command: "npm test" } }],
      "blocked",
      "Bash(npm test)",
    );
    expect(html).toContain("Permission");
    expect(html).toContain(">Yes<");
    expect(html).toContain("waiting on you · Bash(npm test)");
  });

  // a Notification can move the status off "asking" while the question is
  // still open; the hook clears the ask itself when the tool ends
  it("shows the question card whenever an ask is open", () => {
    const ask = {
      workspaceId: "w",
      sessionKey: "s",
      sessionId: "x",
      ts: 0,
      questions: [
        {
          question: "Which close signal?",
          header: "Close signal",
          multiSelect: false,
          options: [{ label: "Stop", description: "" }],
        },
      ],
    };
    const withAsk = (kind: StatusKind, items: ScreenItem[] = []) =>
      renderToStaticMarkup(
        <SessionScreen
          sessionKey="s"
          items={items}
          status={{ kind, call: "Bash(npm test)" }}
          ask={ask}
          onAskAnswer={noop}
          onWrite={noop}
          onShowRaw={noop}
          footer={null}
        />,
      );
    expect(withAsk("idle")).toContain("Which close signal?");

    const both = withAsk("blocked", [
      { kind: "tool", id: "t", name: "Bash", input: { command: "npm test" } },
    ]);
    expect(both).toContain("Which close signal?");
    expect(both).toContain("Permission");
    expect(both.indexOf("Which close signal?")).toBeLessThan(
      both.indexOf("Permission"),
    );
  });

  it("shows the live line while working", () => {
    const html = render([], "working", "Read(a.ts)");
    expect(html).toContain("working · Read(a.ts)");
    expect(html).toContain("hud-breathe");
  });

  it("draws prompts, thinking and notices", () => {
    const html = render(
      [
        { kind: "prompt", id: "1", text: "hello" },
        { kind: "thinking", id: "2" },
        { kind: "notice", id: "3", text: "compacted" },
      ],
      "idle",
    );
    expect(html).toContain("hello");
    expect(html).toContain("Thinking…");
    expect(html).toContain("compacted");
    expect(html).toContain("FOOTER");
  });

  it("lists the known gaps", () => {
    const html = render([], "working", "x");
    expect(html).toContain(
      `Only in the raw terminal: ${KNOWN_GAPS.join(", ")}`,
    );
  });
});
