export interface TextOption {
  label: string;
  description: string;
  reply: string;
}

export interface TextQuestion {
  question: string;
  options: TextOption[];
}

const MAX_OPTIONS = 8;
// Optional bold, a bullet / number / letter marker, optional bold, then a space.
const ITEM = /^(?:\*\*)?([-*+]|\d+[.)]|[A-Za-z][.)])(?:\*\*)?\s+(\S.*)$/;
const INDENTED = /^\s+\S/;

function toOption(lines: string[]): TextOption {
  const [first, ...rest] = lines;
  const match = ITEM.exec(first) as RegExpExecArray;
  const label = match[2].replace(/\*\*/g, "").trim();
  return {
    label,
    description: rest.map((l) => l.trim()).join(" "),
    reply: /^[-*+]$/.test(match[1]) ? label : `${match[1]} ${label}`,
  };
}

// The list that makes up the tail of a paragraph: the first item line from which
// every remaining line is an item or an indented continuation. Returns where it
// starts and its items, or null when the paragraph does not end on a 2+ item list.
function trailingList(
  lines: string[],
): { start: number; items: TextOption[] } | null {
  for (let start = 0; start < lines.length; start++) {
    if (!ITEM.test(lines[start])) continue;
    const tail = lines.slice(start);
    if (!tail.every((l) => ITEM.test(l) || INDENTED.test(l))) continue;
    const groups: string[][] = [];
    for (const line of tail) {
      if (ITEM.test(line)) groups.push([line]);
      else groups[groups.length - 1].push(line);
    }
    if (groups.length < 2) return null;
    return { start, items: groups.map(toOption) };
  }
  return null;
}

// A removed code block leaves this paragraph behind, so text that ends on a
// block never reads as ending on the question above it.
const CODE_MARKER = "[code]";
const HEADING = /^#{1,6}\s/;
const BOLD_ONLY = /^\*\*[^*]+\*\*[:\s]*$/;

// Fenced blocks and quoted lines are content, not the assistant's own question.
function withoutCodeAndQuotes(text: string): string {
  const kept: string[] = [];
  let fence: string | null = null;
  for (const line of text.replace(/\r\n/g, "\n").split("\n")) {
    const marker = /^\s*(```|~~~)/.exec(line)?.[1] ?? null;
    if (fence) {
      if (marker === fence) fence = null;
    } else if (marker) {
      fence = marker;
      kept.push("", CODE_MARKER, "");
    } else if (!/^\s*>/.test(line)) {
      kept.push(line);
    }
  }
  return kept.join("\n");
}

const endsWith = (text: string, tail: RegExp): boolean =>
  text.replace(tail, "").endsWith("?");

const isListLine = (l: string): boolean => ITEM.test(l) || INDENTED.test(l);

// Blank lines between items split one list into paragraphs; this glues an
// all-item paragraph onto the item paragraph, or the list tail, before it.
function joinLooseLists(paragraphs: string[][]): string[][] {
  const joined: string[][] = [];
  for (const lines of paragraphs) {
    const prev = joined[joined.length - 1];
    if (
      prev &&
      lines.every(isListLine) &&
      (prev.every(isListLine) || trailingList(prev))
    ) {
      prev.push(...lines);
    } else {
      joined.push([...lines]);
    }
  }
  return joined;
}

// "?" ends the text, or one short sentence on the same line follows the last
// "?". A sentence-ending "?" touches a word and is followed by a space, a closer
// or the end, so "a ? b" and "a?b=1" are not one.
function endsOnQuestion(text: string): boolean {
  if (endsWith(text, /[*_`\s]+$/)) return true;
  const mark = [...text.matchAll(/\S\?(?=[\s)\]"'*_`]|$)/g)].pop();
  if (!mark) return false;
  const tail = text.slice(mark.index + 2).trimEnd();
  return /^[^\S\n]*\S[^?\n]{0,79}$/.test(tail);
}

// ponytail: a statement naming "A or B" reads as a question; tighten to a request verb if that shows up live.
function isChoiceRequest(line: string): boolean {
  const request = line
    .replace(/^\*\*[^*]+\*\*\s*[-–—:]\s*|^\*\*[^*]+:\*\*\s+/, "")
    .replace(/^Or\s+/, "");
  return (
    /^(reply with|tell me|let me know which|pick|choose)\b/i.test(request) ||
    /\b[A-Z] or [A-Z]\b/.test(request)
  );
}

// "Option A, ..." lines in the paragraph, one option per letter.
function letterOptions(lines: string[]): TextOption[] {
  const byLetter = new Map<string, TextOption>();
  for (const line of lines) {
    const match = /\bOption ([A-Z])\b[,:.]?\s*(.*)/.exec(line);
    if (match && !byLetter.has(match[1])) {
      byLetter.set(match[1], {
        label: `Option ${match[1]}`,
        description: match[2].replace(/\*\*/g, "").trim(),
        reply: match[1],
      });
    }
  }
  return capOptions([...byLetter.values()]);
}

function capOptions(items: TextOption[]): TextOption[] {
  return items.length > MAX_OPTIONS ? [] : items;
}

// A turn that stops on a plain-text question either ends its last paragraph with
// "?", or ends on a list introduced by a "?" line. Options come from the list
// after the question, else from a list directly before the question paragraph.
export function parseTextQuestion(text: string): TextQuestion | null {
  const paragraphs = joinLooseLists(
    withoutCodeAndQuotes(text)
      .split(/\n\s*\n/)
      .map((p) => p.split("\n").filter((l) => l.trim() !== ""))
      .filter((lines) => lines.length > 0),
  );
  const last = paragraphs[paragraphs.length - 1];
  if (!last) return null;

  const list = trailingList(last);
  if (list) {
    const above =
      list.start > 0
        ? last.slice(0, list.start).join("\n")
        : (paragraphs[paragraphs.length - 2] ?? []).join("\n");
    const question = above.trim();
    const questionLine = question.split("\n").pop() ?? "";
    if (
      !HEADING.test(questionLine) &&
      !BOLD_ONLY.test(questionLine) &&
      endsWith(question, /[:*_\s]+$/)
    ) {
      return { question, options: capOptions(list.items) };
    }
  }

  const lastText = last.join("\n").trim();
  if (HEADING.test(last[last.length - 1])) return null;
  // A "?" or "A or B" inside an inline code span is code, not the assistant asking.
  const prose = lastText.replace(/`[^`\n]*`/g, "");
  const proseLastLine = last[last.length - 1].replace(/`[^`\n]*`/g, "");
  if (!endsOnQuestion(prose) && !isChoiceRequest(proseLastLine)) {
    return null;
  }
  const before = paragraphs[paragraphs.length - 2];
  const listBefore = before ? trailingList(before) : null;
  return {
    question: lastText,
    options: listBefore ? capOptions(listBefore.items) : letterOptions(last),
  };
}
