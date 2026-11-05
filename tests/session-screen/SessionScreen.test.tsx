// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import SessionScreen, {
  KNOWN_GAPS,
} from "../../src/renderer/session-screen/SessionScreen";
import type { ScreenItem } from "../../src/renderer/session-screen/screen-state";
import type { StatusKind } from "../../src/shared/types";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

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
  it("drops an earlier Thinking line once output follows it", () => {
    const html = render(
      [
        { kind: "thinking", id: "a" },
        { kind: "text", id: "b", markdown: "done" },
      ],
      "working",
    );
    expect(html).not.toContain("Thinking…");
  });

  it("shows Thinking while it is the newest item of a working turn", () => {
    expect(render([{ kind: "thinking", id: "a" }], "working")).toContain(
      "Thinking…",
    );
  });

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

  it("drops the separator when there is no call", () => {
    const html = render([], "working");
    expect(html).toContain("<span>working</span>");
    expect(html).not.toContain("working ·");
  });

  it("draws prompts, thinking and notices", () => {
    const html = render(
      [
        { kind: "prompt", id: "1", text: "hello" },
        { kind: "notice", id: "3", text: "compacted" },
        { kind: "thinking", id: "2" },
      ],
      "working",
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

  describe("task rows", () => {
    const task = (failed: boolean): ScreenItem => ({
      kind: "task",
      id: "t",
      summary: "Background command done",
      failed,
      full: "<task-notification><task-id>abc123</task-id></task-notification>",
    });

    it("shows the summary and not the raw block", () => {
      const html = render([task(false)], "idle");
      expect(html).toContain("Background command done");
      expect(html).not.toContain("task-id");
    });

    it("opens the full block on click", async () => {
      vi.stubGlobal(
        "ResizeObserver",
        class {
          observe = vi.fn();
          unobserve = vi.fn();
          disconnect = vi.fn();
        },
      );
      const host = document.createElement("div");
      const root = createRoot(host);
      await act(async () => {
        root.render(
          <SessionScreen
            sessionKey="s"
            items={[task(false)]}
            status={{ kind: "idle", call: "" }}
            onAskAnswer={noop}
            onWrite={noop}
            onShowRaw={noop}
            footer={null}
          />,
        );
      });
      const button = host.querySelector("button[aria-expanded]") as HTMLElement;
      expect(button.getAttribute("aria-expanded")).toBe("false");
      expect(host.querySelector("pre")).toBeNull();
      await act(async () => {
        button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
      expect(button.getAttribute("aria-expanded")).toBe("true");
      expect(host.querySelector("pre")?.textContent).toContain("<task-id>");
      await act(async () => root.unmount());
      vi.unstubAllGlobals();
    });

    it("colours the dot warm when failed and accent otherwise", () => {
      expect(render([task(true)], "idle")).toContain(
        `<span class="text-warm">●</span>`,
      );
      expect(render([task(false)], "idle")).toContain(
        `<span class="text-accent">●</span>`,
      );
    });
  });
});
