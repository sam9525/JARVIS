import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { parseTextQuestion } from "../../src/shared/text-question";

const isQuestion = (text: string) => parseTextQuestion(text) !== null;

describe("parseTextQuestion", () => {
  it("reads the last paragraph only", () => {
    expect(isQuestion("Done.\n\nShould I merge it?")).toBe(true);
    expect(isQuestion("Should I?\n\nLet me know if you want changes.")).toBe(
      false,
    );
  });

  it("ignores emphasis marks around the question mark", () => {
    expect(isQuestion("**Next** - is a fresh session fine?**")).toBe(true);
  });

  it("normalises CRLF paragraph breaks", () => {
    expect(isQuestion("Ok?\r\n\r\nAll set.")).toBe(false);
    expect(isQuestion("Ready.\r\n\r\nShip it?")).toBe(true);
  });

  it("is not a question when the last paragraph is a code fence", () => {
    expect(isQuestion("Is this right?\n\n```\nx?\n```")).toBe(false);
  });

  it("is not a question for empty text", () => {
    expect(isQuestion("")).toBe(false);
  });

  it("takes options from the list after the question", () => {
    expect(parseTextQuestion("Which one?\n\n1. Fast\n2. Safe")).toEqual({
      question: "Which one?",
      options: [
        { label: "Fast", description: "", reply: "1. Fast" },
        { label: "Safe", description: "", reply: "2. Safe" },
      ],
    });
  });

  it("a bullet option replies with its label alone", () => {
    const replies = (text: string) =>
      parseTextQuestion(text)?.options.map((o) => o.reply);
    expect(replies("Pick one?\n- Fast\n- Safe")).toEqual(["Fast", "Safe"]);
    expect(replies("Pick one?\n1. Fast\n2. Safe")).toEqual([
      "1. Fast",
      "2. Safe",
    ]);
  });

  it("is not a question when the text before the list has no question mark", () => {
    expect(parseTextQuestion("Pick one:\n- **Keep** it\n- Drop it")).toBeNull();
  });

  it("finds a list directly under the question in the same paragraph", () => {
    const q = parseTextQuestion("Which approach?\n- Keep it\n- Drop it");
    expect(q?.question).toBe("Which approach?");
    expect(q?.options).toHaveLength(2);
  });

  it("takes options from a list before the question paragraph", () => {
    const q = parseTextQuestion(
      "**A.** Cache\n**B.** Rewrite\n\nWhich do you want?",
    );
    expect(q?.question).toBe("Which do you want?");
    expect(q?.options.map((o) => o.label)).toEqual(["Cache", "Rewrite"]);
    expect(q?.options.map((o) => o.reply)).toEqual(["A. Cache", "B. Rewrite"]);
  });

  it("joins indented continuation lines into the description", () => {
    const q = parseTextQuestion(
      "Which?\n\n1. Fast\n   uses more memory\n2. Safe",
    );
    expect(q?.options[0].description).toBe("uses more memory");
    expect(q?.options[1].description).toBe("");
  });

  it("is not a question when a list follows a statement", () => {
    expect(parseTextQuestion("Done. Changed:\n\n- a\n- b")).toBeNull();
  });

  it("returns no options for more than eight items", () => {
    const items = Array.from({ length: 9 }, (_, i) => `${i + 1}. item ${i}`);
    const q = parseTextQuestion(`Which?\n\n${items.join("\n")}`);
    expect(q?.question).toBe("Which?");
    expect(q?.options).toEqual([]);
  });

  it("ignores a question mark inside an inline code span", () => {
    expect(parseTextQuestion("Use `a?b` here.\n\nDone.")).toBeNull();
  });

  it("returns a question without options for a lone question", () => {
    expect(parseTextQuestion("Should I merge?")).toEqual({
      question: "Should I merge?",
      options: [],
    });
  });
});

describe("parseTextQuestion: not a question", () => {
  it("P1 ignores a question inside a code block with a blank line", () => {
    expect(
      isQuestion(
        "Snippet:\n\n```ts\nconst a = 1;\n\nconst ok = x ? y : z; // why?\n```",
      ),
    ).toBe(false);
    expect(isQuestion('Run:\n\n~~~\nread -p "Go?"\n\necho "done?"\n~~~')).toBe(
      false,
    );
  });

  it("P1 treats an unclosed fence as running to the end", () => {
    expect(isQuestion("Done.\n\n```\nwhy?")).toBe(false);
  });

  it("P2 ignores a heading or bold label over a list of statements", () => {
    expect(
      isQuestion(
        "## Why did it fail?\n\n- The cache was stale\n- The key was wrong",
      ),
    ).toBe(false);
    expect(
      isQuestion("**What changed?**\n\n- Fixed the parser\n- Added tests"),
    ).toBe(false);
    expect(isQuestion("Summary.\n\n### Next steps?")).toBe(false);
  });

  it("P3 ignores a quoted question", () => {
    expect(isQuestion("You asked:\n\n> Can you check the logs?")).toBe(false);
  });

  it("still reads a plain question line over a list", () => {
    expect(
      parseTextQuestion("Which approach?\n\n1. A\n2. B")?.options.map(
        (o) => o.label,
      ),
    ).toEqual(["A", "B"]);
  });
});

describe("parseTextQuestion: real questions", () => {
  it("N1 reads a loose list after the question", () => {
    const q = parseTextQuestion(
      "Which approach?\n\n1. **A** — fast\n\n2. **B** — safe",
    );
    expect(q?.options.map((o) => o.reply)).toEqual([
      "1. A — fast",
      "2. B — safe",
    ]);
    expect(
      parseTextQuestion("Which one?\n\n- A\n\n- B\n\n- C")?.options,
    ).toHaveLength(3);
  });

  it("ignores a ? inside inline code but keeps a real question around code", () => {
    expect(isQuestion("Made `timeout?` optional in the config.")).toBe(false);
    expect(isQuestion("Should I rename `foo` to `bar`?")).toBe(true);
  });

  it("N3 reads a bold label whose colon is inside the bold", () => {
    expect(isQuestion("**Next:** Tell me which one you want.")).toBe(true);
  });

  it("N2 reads a question followed by a short tail", () => {
    expect(isQuestion("Want me to open a PR? Let me know.")).toBe(true);
    expect(isQuestion("Should I also update the docs? (It is optional.)")).toBe(
      true,
    );
    expect(isQuestion("Is it done? " + "x".repeat(81) + ".")).toBe(false);
  });

  it("N2 ignores a tail on another line and a ? that ends no sentence", () => {
    expect(isQuestion("Did the build pass?\nYes, it is green.")).toBe(false);
    expect(isQuestion("Updated the URL to https://x.com/a?b=1.")).toBe(false);
    expect(isQuestion("I used a ? b : c in the helper.")).toBe(false);
  });

  it("N3 reads a request to choose with no question mark", () => {
    expect(
      isQuestion(
        "Options above.\n\n**Next** - Reply with A or B, or correct anything above.",
      ),
    ).toBe(true);
    expect(
      isQuestion("Which one?\n\n1. A\n2. B\n\nOr tell me something else."),
    ).toBe(true);
    expect(isQuestion("Pick one of the two.")).toBe(true);
    expect(isQuestion("Choose the branch name.")).toBe(true);
    expect(isQuestion("All tests pass. The build is green.")).toBe(false);
  });

  it("N3 reads the real missed message and its Option lines", () => {
    const text = readFileSync(
      join(__dirname, "../fixtures/text-question/choice-request.md"),
      "utf8",
    );
    const q = parseTextQuestion(text);
    expect(q).not.toBeNull();
    expect(q?.options.map((o) => o.reply)).toEqual(["A", "B"]);
  });
});
