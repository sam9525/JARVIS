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
    reply: `${match[1]} ${label}`,
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

const endsWith = (text: string, tail: RegExp): boolean =>
  text.replace(tail, "").endsWith("?");

function capOptions(items: TextOption[]): TextOption[] {
  return items.length > MAX_OPTIONS ? [] : items;
}

// A turn that stops on a plain-text question either ends its last paragraph with
// "?", or ends on a list introduced by a "?" line. Options come from the list
// after the question, else from a list directly before the question paragraph.
export function parseTextQuestion(text: string): TextQuestion | null {
  const paragraphs = text
    .replace(/\r\n/g, "\n")
    .split(/\n\s*\n/)
    .map((p) => p.split("\n").filter((l) => l.trim() !== ""))
    .filter((lines) => lines.length > 0);
  const last = paragraphs[paragraphs.length - 1];
  if (!last) return null;

  const list = trailingList(last);
  if (list) {
    const above =
      list.start > 0
        ? last.slice(0, list.start).join("\n")
        : (paragraphs[paragraphs.length - 2] ?? []).join("\n");
    const question = above.trim();
    if (endsWith(question, /[:*_\s]+$/)) {
      return { question, options: capOptions(list.items) };
    }
  }

  const lastText = last.join("\n").trim();
  if (lastText.startsWith("```")) return null;
  if (!endsWith(lastText, /[*_`\s]+$/)) return null;
  const before = paragraphs[paragraphs.length - 2];
  const listBefore = before ? trailingList(before) : null;
  return {
    question: lastText,
    options: listBefore ? capOptions(listBefore.items) : [],
  };
}
