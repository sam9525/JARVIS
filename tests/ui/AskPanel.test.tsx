/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-empty-function */
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// values handed to the next useState calls in order: index, sent, typed
const seeded = vi.hoisted(() => [] as any[]);

vi.mock("react", async () => {
  const actual = (await vi.importActual("react")) as any;
  return {
    ...actual,
    useState: (init: any) => [
      seeded.length
        ? seeded.shift()
        : typeof init === "function"
          ? init()
          : init,
      () => {},
    ],
  };
});

import AskPanel, { answerKeys, pickAsk } from "../../src/renderer/ui/AskPanel";
import type { AskPrompt } from "../../src/main/ask-mapper";

// depth-first, source order
const walk = (n: any): any[] =>
  !n || typeof n !== "object"
    ? []
    : Array.isArray(n)
      ? n.flatMap(walk)
      : [n, ...walk(n.props?.children)];

const prompt = (over: Partial<AskPrompt["questions"][0]> = {}): AskPrompt => ({
  workspaceId: "w1",
  sessionId: "s1",
  ts: 0,
  questions: [
    {
      question: "Which close signal?",
      header: "Close signal",
      multiSelect: false,
      options: [
        { label: "Widen PostToolUse", description: "the answer arrives" },
        { label: "Close on click", description: "no hook change" },
      ],
      ...over,
    },
  ],
});

describe("AskPanel", () => {
  it("renders the question, the header and every option", () => {
    const html = renderToStaticMarkup(
      <AskPanel prompt={prompt()} workspaceName="jarvis" onAnswer={() => {}} />,
    );
    expect(html).toContain("Which close signal?");
    expect(html).toContain("Close signal");
    expect(html).toContain("Widen PostToolUse");
    expect(html).toContain("no hook change");
  });

  it("always names the terminal as the authority", () => {
    const html = renderToStaticMarkup(
      <AskPanel prompt={prompt()} workspaceName="jarvis" onAnswer={() => {}} />,
    );
    expect(html.toLowerCase()).toContain("terminal");
  });

  it("homes the cursor before stepping down to the option", () => {
    // one up per option, then one down per step — the whole contract with the
    // TUI, and the only bytes this app ever puts into a live picker
    expect(answerKeys(0, 3)).toBe("\x1b[A\x1b[A\x1b[A");
    expect(answerKeys(2, 3)).toBe("\x1b[A\x1b[A\x1b[A\x1b[B\x1b[B");
    expect(answerKeys(0, 0)).toBe("");
  });

  it("reports the clicked option's keystrokes", () => {
    const onAnswer = vi.fn();
    const tree = (
      <AskPanel prompt={prompt()} workspaceName="jarvis" onAnswer={onAnswer} />
    ) as any;
    const rows = walk(tree.type(tree.props)).filter((n: any) =>
      n?.props?.["data-testid"]?.startsWith?.("ask-option-"),
    );
    expect(rows).toHaveLength(2);
    rows[1].props.onClick();
    // two options plus Claude Code's own "Type something." row
    expect(onAnswer).toHaveBeenCalledWith([answerKeys(1, 3), "\r"]);
  });

  it("types a free answer into the Type something row", () => {
    const onAnswer = vi.fn();
    seeded.push(0, false, "  use JWT\n");
    const tree = (
      <AskPanel prompt={prompt()} workspaceName="jarvis" onAnswer={onAnswer} />
    ) as any;
    walk(tree.type(tree.props))
      .find((n: any) => n?.props?.["data-testid"] === "ask-typed")
      .props.onKeyDown({ key: "Enter" });
    expect(onAnswer).toHaveBeenCalledWith([answerKeys(2, 3), "use JWT", "\r"]);
  });

  it("confirms the review screen after the last of several questions", () => {
    const onAnswer = vi.fn();
    const p = prompt();
    p.questions.push({ ...p.questions[0], question: "Second?" });
    const click = () => {
      const tree = (
        <AskPanel prompt={p} workspaceName="jarvis" onAnswer={onAnswer} />
      ) as any;
      walk(tree.type(tree.props))
        .find((n: any) => n?.props?.["data-testid"] === "ask-option-0")
        .props.onClick();
    };
    click();
    expect(onAnswer).toHaveBeenLastCalledWith([answerKeys(0, 3), "\r"]);
    seeded.push(1);
    click();
    expect(onAnswer).toHaveBeenLastCalledWith([answerKeys(0, 3), "\r", "\r"]);
  });

  it("shows this screen's question first, else the newest in the fleet", () => {
    const at = (workspaceId: string, ts: number) => ({
      ...prompt(),
      workspaceId,
      ts,
    });
    const asks = new Map([
      ["w1", at("w1", 1)],
      ["w2", at("w2", 3)],
      ["w3", at("w3", 2)],
    ]);
    expect(pickAsk(asks, "w1")?.workspaceId).toBe("w1");
    expect(pickAsk(asks, "w9")?.workspaceId).toBe("w2");
    expect(pickAsk(asks, undefined)?.workspaceId).toBe("w2");
    expect(pickAsk(new Map(), "w1")).toBeUndefined();
  });

  it("gives a multi-select question no click target", () => {
    const tree = (
      <AskPanel
        prompt={prompt({ multiSelect: true })}
        workspaceName="jarvis"
        onAnswer={() => {}}
      />
    ) as any;
    const rows = walk(tree.type(tree.props)).filter((n: any) =>
      n?.props?.["data-testid"]?.startsWith?.("ask-option-"),
    );
    expect(rows).toHaveLength(2);
    for (const r of rows) expect(r.props.onClick).toBeUndefined();
  });

  it("gives an Other option no click target either", () => {
    const p = prompt();
    p.questions[0].options.push({ label: "Other", description: "" });
    const tree = (
      <AskPanel prompt={p} workspaceName="jarvis" onAnswer={() => {}} />
    ) as any;
    const rows = walk(tree.type(tree.props)).filter((n: any) =>
      n?.props?.["data-testid"]?.startsWith?.("ask-option-"),
    );
    for (const r of rows) expect(r.props.onClick).toBeUndefined();
  });
});
