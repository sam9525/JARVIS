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
