// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import AskPanel, { type ReplyResult } from "../../src/renderer/ui/AskPanel";
import type { AskPrompt } from "../../src/main/ask-mapper";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const textPrompt: AskPrompt = {
  workspaceId: "w1",
  sessionKey: "w1",
  sessionId: "s1",
  ts: 0,
  source: "text",
  questions: [
    {
      question: "Which approach?",
      header: "",
      multiSelect: false,
      options: [
        { label: "Fast", description: "", reply: "1. Fast" },
        { label: "Safe", description: "", reply: "2. Safe" },
      ],
    },
  ],
};

describe("AskPanel text reply, sent once", () => {
  let root: Root | undefined;
  let container: HTMLElement | undefined;
  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
  });

  const mountPanel = async (onAnswer: () => Promise<boolean | ReplyResult>) => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root!.render(
        <AskPanel prompt={textPrompt} workspaceName="w" onAnswer={onAnswer} />,
      );
    });
  };
  const click = async (i: number) => {
    await act(async () => {
      (
        container!.querySelector(
          `[data-testid="ask-option-${i}"]`,
        ) as HTMLElement
      ).click();
    });
  };

  it("ignores a second click once a reply was sent", async () => {
    const onAnswer = vi.fn(() => Promise.resolve(true));
    await mountPanel(onAnswer);
    await click(0);
    await click(1);
    expect(onAnswer).toHaveBeenCalledTimes(1);
  });

  it("allows a retry after a refused send", async () => {
    const onAnswer = vi.fn(() => Promise.resolve<ReplyResult>("draft"));
    await mountPanel(onAnswer);
    await click(0);
    await click(1);
    expect(onAnswer).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["draft", "clear the draft first, or answer in the terminal"],
    ["no-terminal", "no terminal is open for this session"],
  ] as const)(
    "says why a %s refusal happened and allows a retry",
    async (result, copy) => {
      const onAnswer = vi.fn(() => Promise.resolve<ReplyResult>(result));
      await mountPanel(onAnswer);
      await click(0);
      expect(container!.textContent).toContain(copy);
      await click(1);
      expect(onAnswer).toHaveBeenCalledTimes(2);
    },
  );
});
