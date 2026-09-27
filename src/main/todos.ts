import {
  projectKey,
  type Todo,
  type TodoList,
  type TodoOp,
  type TodoOpResult,
} from "../shared/types";

const TASK = /^- \[([ xX])\] (.*)$/;
const DATE = /\s(\d{4}-\d{2}-\d{2})$/;
const PROJECT = /\s@(\S+)$/;
// "-[ ] a", "* [ ] a", "- []": the agent meant a task and missed the shape
const LOOKS_LIKE_TASK = /^\s*[-*+]?\s*\[[ xX]?\]/;

export type ApplyResult =
  | { ok: true; file: string }
  | { ok: false; error: string };

export interface TodoIO {
  read(): Promise<string>;
  write(file: string): Promise<void>;
}

// The date is stripped before the project, and only the last token of each:
// a date the user typed inside the text stays text, because the created date
// is always appended after it.
export function parseLine(raw: string, line: number): Todo | null {
  const m = TASK.exec(raw.trimEnd());
  if (!m) return null;
  let rest = " " + m[2].trim();
  let created: string | null = null;
  const d = DATE.exec(rest);
  if (d) {
    created = d[1];
    rest = rest.slice(0, d.index);
  }
  let project: string | null = null;
  const p = PROJECT.exec(rest);
  if (p) {
    project = p[1];
    rest = rest.slice(0, p.index);
  }
  const text = rest.trim();
  if (!text) return null;
  return { line, raw, done: m[1] !== " ", text, project, created };
}

function splitLines(file: string): { eol: string; lines: string[] } {
  const eol = file.includes("\r\n") ? "\r\n" : "\n";
  return { eol, lines: file === "" ? [] : file.split(/\r?\n/) };
}

export function parseTodos(file: string): TodoList {
  const todos: Todo[] = [];
  const malformed: TodoList["malformed"] = [];
  splitLines(file).lines.forEach((raw, line) => {
    const todo = parseLine(raw, line);
    if (todo) todos.push(todo);
    else if (LOOKS_LIKE_TASK.test(raw) || TASK.test(raw.trimEnd()))
      malformed.push({ line, raw });
  });
  return { todos, malformed };
}

export function formatLine(t: {
  done: boolean;
  text: string;
  project: string | null;
  created: string | null;
}): string {
  return (
    "- [" + (t.done ? "x" : " ") + "] " + t.text +
    (t.project ? " @" + projectKey(t.project) : "") +
    (t.created ? " " + t.created : "")
  );
}

// a pasted newline would split one task into two lines
const cleanText = (text: string): string => text.replace(/\s+/g, " ").trim();

export function applyOp(file: string, op: TodoOp, today: string): ApplyResult {
  const { eol, lines } = splitLines(file);
  const done = (): ApplyResult => ({ ok: true, file: lines.join(eol) });

  if (op.kind === "add") {
    const text = cleanText(op.text);
    if (!text) return { ok: false, error: "empty task" };
    const row = formatLine({ done: false, text, project: op.project, created: today });
    if (lines.length === 0) lines.push(row, "");
    else if (lines[lines.length - 1] === "") lines.splice(lines.length - 1, 0, row);
    else lines.push(row);
    return done();
  }

  const current = lines[op.line] === op.raw ? parseLine(op.raw, op.line) : null;
  if (!current) return { ok: false, error: "stale" };

  if (op.kind === "toggle") {
    lines[op.line] = formatLine({ ...current, done: !current.done });
  } else if (op.kind === "delete") {
    lines.splice(op.line, 1);
  } else if (op.kind === "edit") {
    const text = cleanText(op.text);
    if (!text) return { ok: false, error: "empty task" };
    lines[op.line] = formatLine({ ...current, text, project: op.project });
  } else {
    if (lines[op.toLine] !== op.toRaw) return { ok: false, error: "stale" };
    // remove, then insert at the target's old index: the row lands after the
    // target when moving down and before it when moving up
    const [row] = lines.splice(op.line, 1);
    lines.splice(op.toLine, 0, row);
  }
  return done();
}

// Every op re-reads the file inside the queue, so two fast panel clicks can't
// both read the same old file and have the second write erase the first.
export function createTodoStore(io: TodoIO, today: () => string) {
  let queue: Promise<unknown> = Promise.resolve();
  return {
    async list(): Promise<TodoList> {
      return parseTodos(await io.read());
    },
    apply(op: TodoOp): Promise<TodoOpResult> {
      const run = queue.then(async (): Promise<TodoOpResult> => {
        const r = applyOp(await io.read(), op, today());
        if (!r.ok) return r;
        await io.write(r.file);
        return { ok: true };
      });
      queue = run.catch(() => undefined);
      return run;
    },
  };
}