/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-empty-function */
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// values handed to the next useState calls in order: index, sent, typed,
// refused
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
    useRef: (init: any) => ({ current: init }),
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
  sessionKey: "w1",
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

  it("homes over a confirm's own rows only, so No lands on No", () => {
    const onAnswer = vi.fn();
    const confirm: AskPrompt = { ...prompt(), source: "confirm" };
    const tree = (
      <AskPanel prompt={confirm} workspaceName="jarvis" onAnswer={onAnswer} />
    ) as any;
    const nodes = walk(tree.type(tree.props));
    nodes
      .filter((n: any) =>
        n?.props?.["data-testid"]?.startsWith?.("ask-option-"),
      )[1]
      .props.onClick();
    // Claude Code's confirm wraps and has no "Type something." row: a third
    // Up would step from Yes to No, and the Down would then land on Yes
    expect(onAnswer).toHaveBeenCalledWith([answerKeys(1, 2), "\r"]);
    expect(
      nodes.some((n: any) => n?.props?.["data-testid"] === "ask-typed"),
    ).toBe(false);
  });

  it("types an option's own keys, with no Enter after them", () => {
    const onAnswer = vi.fn();
    const p: AskPrompt = { ...prompt(), source: "confirm" };
    p.questions = [
      {
        ...p.questions[0],
        options: [{ label: "Resume as-is", description: "", keys: "\x1b" }],
      },
    ];
    const tree = (
      <AskPanel prompt={p} workspaceName="jarvis" onAnswer={onAnswer} />
    ) as any;
    walk(tree.type(tree.props))
      .find((n: any) => n?.props?.["data-testid"] === "ask-option-0")
      .props.onClick();
    expect(onAnswer).toHaveBeenCalledWith(["\x1b"]);
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
      sessionKey: workspaceId,
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

  it("picks by session key: the own session first, else the newest", () => {
    const at = (sessionKey: string, ts: number) => ({
      ...prompt(),
      workspaceId: "d:/r",
      sessionKey,
      ts,
    });
    const asks = new Map([
      ["d:/r", at("d:/r", 1)],
      ["d:/r#1", at("d:/r#1", 5)],
    ]);
    expect(pickAsk(asks, "d:/r")?.sessionKey).toBe("d:/r");
    expect(pickAsk(asks, "d:/r#1")?.sessionKey).toBe("d:/r#1");
    expect(pickAsk(asks, "d:/r#2")?.sessionKey).toBe("d:/r#1");
  });

  // the session screen answers its own question inline, so the floating
  // panel must not show it a second time
  it("pickAsk skips the excluded session", () => {
    const at = (sessionKey: string, ts: number) => ({
      ...prompt(),
      workspaceId: "d:/r",
      sessionKey,
      ts,
    });
    const asks = new Map([
      ["d:/r", at("d:/r", 1)],
      ["d:/r#1", at("d:/r#1", 5)],
    ]);
    expect(pickAsk(asks, "d:/r", "d:/r")?.sessionKey).toBe("d:/r#1");
    expect(pickAsk(asks, "d:/r#2", "d:/r#1")?.sessionKey).toBe("d:/r");
    expect(
      pickAsk(new Map([["d:/r", at("d:/r", 1)]]), "d:/r", "d:/r"),
    ).toBeUndefined();
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

  describe("doc preview row", () => {
    const docPrompt = (
      headers: string[],
      docs: AskPrompt["docs"],
    ): AskPrompt => {
      const p = prompt({ header: headers[0] });
      for (const header of headers.slice(1)) {
        p.questions.push({ ...p.questions[0], header });
      }
      p.docs = docs;
      return p;
    };
    const rowOf = (p: AskPrompt, onOpenDoc?: (id: string) => void) => {
      const onAnswer = vi.fn();
      const tree = (
        <AskPanel
          prompt={p}
          workspaceName="jarvis"
          onAnswer={onAnswer}
          onOpenDoc={onOpenDoc}
        />
      ) as any;
      const out = tree.type(tree.props);
      return {
        onAnswer,
        row: walk(out).find(
          (n: any) => n?.props?.["data-testid"] === "ask-doc",
        ),
        html: renderToStaticMarkup(
          <AskPanel
            prompt={p}
            workspaceName="jarvis"
            onAnswer={onAnswer}
            onOpenDoc={onOpenDoc}
          />,
        ),
        options: walk(out).filter((n: any) =>
          n?.props?.["data-testid"]?.startsWith?.("ask-option-"),
        ),
      };
    };
    const path = "docs/superpowers/specs/a.md";

    it("shows the preview row for a Spec gate header", () => {
      const { html } = rowOf(docPrompt(["Spec gate"], { spec: path }), vi.fn());
      expect(html).toContain("Preview the spec");
    });

    it("opens the written spec without answering", () => {
      const onOpenDoc = vi.fn();
      const { row, html, onAnswer, options } = rowOf(
        docPrompt(["Spec"], { spec: path }),
        onOpenDoc,
      );
      expect(html).toContain("Preview the spec");
      expect(html).toContain(path);
      row.props.onClick();
      expect(onOpenDoc).toHaveBeenCalledWith(path);
      expect(onAnswer).not.toHaveBeenCalled();
      expect(options).toHaveLength(2);
    });

    it("needs a doc of the header's kind", () => {
      expect(
        rowOf(docPrompt(["Plan"], { spec: path }), vi.fn()).row,
      ).toBeUndefined();
    });

    it("ignores other headers", () => {
      expect(
        rowOf(docPrompt(["Close signal"], { spec: path }), vi.fn()).row,
      ).toBeUndefined();
    });

    it("needs onOpenDoc", () => {
      expect(rowOf(docPrompt(["Spec"], { spec: path })).row).toBeUndefined();
    });

    it("follows the current question", () => {
      // rowOf renders twice, each render reads index, sent, typed, refused
      seeded.push(1, false, "", false, 1, false, "", false);
      const { html } = rowOf(
        docPrompt(["Spec", "Plan"], {
          spec: path,
          plan: "docs/superpowers/plans/b.md",
        }),
        vi.fn(),
      );
      expect(html).toContain("Preview the plan");
    });
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

describe("AskPanel answering a plain-text question", () => {
  const textPrompt = (labels = ["1. Fast", "2. Safe"]): AskPrompt => {
    const p = prompt();
    p.source = "text";
    p.questions[0].options = labels.map((label) => ({
      label,
      description: "",
    }));
    return p;
  };
  const rowsOf = (p: AskPrompt, onAnswer: any) => {
    const tree = (
      <AskPanel prompt={p} workspaceName="jarvis" onAnswer={onAnswer} />
    ) as any;
    return walk(tree.type(tree.props));
  };

  it("sends the clicked option as a reply, with no cursor keys", () => {
    const onAnswer = vi.fn();
    rowsOf(textPrompt(), onAnswer)
      .find((n: any) => n?.props?.["data-testid"] === "ask-option-1")
      .props.onClick();
    expect(onAnswer).toHaveBeenCalledTimes(1);
    expect(onAnswer).toHaveBeenCalledWith(["2. Safe", "\r"]);
  });

  it("sends an option's reply text instead of its label", () => {
    const onAnswer = vi.fn();
    const p = textPrompt();
    p.questions[0].options[0].reply = "fast";
    rowsOf(p, onAnswer)
      .find((n: any) => n?.props?.["data-testid"] === "ask-option-0")
      .props.onClick();
    expect(onAnswer).toHaveBeenCalledWith(["fast", "\r"]);
  });

  it("sends typed text as a reply", () => {
    const onAnswer = vi.fn();
    seeded.push(0, false, "use the cache");
    rowsOf(textPrompt(), onAnswer)
      .find((n: any) => n?.props?.["data-testid"] === "ask-typed")
      .props.onKeyDown({ key: "Enter" });
    expect(onAnswer).toHaveBeenCalledWith(["use the cache", "\r"]);
  });

  it("keeps an option labelled Other clickable", () => {
    const rows = rowsOf(textPrompt(["1. Fast", "Other"]), vi.fn()).filter(
      (n: any) => n?.props?.["data-testid"]?.startsWith?.("ask-option-"),
    );
    for (const r of rows) expect(r.props.onClick).toBeTypeOf("function");
  });

  it("tells the user to clear the draft when the reply is refused", () => {
    seeded.push(0, false, "", "draft");
    const html = renderToStaticMarkup(
      <AskPanel
        prompt={textPrompt()}
        workspaceName="jarvis"
        onAnswer={() => Promise.resolve("draft" as const)}
      />,
    );
    expect(html).toContain("clear the draft first, or answer in the terminal");
    expect(html).toContain("text-warm");
  });

  it("ranks an AskUserQuestion above the viewer's own text question", () => {
    const own = {
      ...prompt(),
      sessionKey: "own",
      ts: 1,
      source: "text" as const,
    };
    const live = { ...prompt(), sessionKey: "other", ts: 0 };
    const asks = new Map([
      ["own", own],
      ["other", live],
    ]);
    expect(pickAsk(asks, "own")?.sessionKey).toBe("other");
    expect(pickAsk(asks, "own", "other")?.sessionKey).toBe("own");
  });

  it("sends a reply once while the first send is outstanding", () => {
    const onAnswer = vi.fn(() => new Promise<boolean>(() => {}));
    const row = rowsOf(textPrompt(), onAnswer).find(
      (n: any) => n?.props?.["data-testid"] === "ask-option-1",
    );
    row.props.onClick();
    row.props.onClick();
    expect(onAnswer).toHaveBeenCalledTimes(1);
  });

  it("ranks an AskUserQuestion above a newer text question", () => {
    const at = (sessionKey: string, ts: number, text: boolean) => {
      const p = { ...prompt(), sessionKey, ts };
      if (text) p.source = "text";
      return p;
    };
    const asks = new Map([
      ["a", at("a", 1, false)],
      ["b", at("b", 5, true)],
    ]);
    expect(pickAsk(asks, undefined)?.sessionKey).toBe("a");
    const texts = new Map([
      ["a", at("a", 1, true)],
      ["b", at("b", 5, true)],
    ]);
    expect(pickAsk(texts, undefined)?.sessionKey).toBe("b");
  });
});
