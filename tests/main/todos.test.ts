import { describe, it, expect } from "vitest";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import {
  applyOp,
  createTodoStore,
  fileTodoIO,
  formatLine,
  parseLine,
  parseTodos,
} from "../../src/main/todos";

const TODAY = "2026-09-27";

describe("parseLine", () => {
  it("reads state, text, project and created date", () => {
    expect(parseLine("- [ ] Fix the ring snap @JARVIS 2026-09-27", 3)).toEqual({
      line: 3,
      raw: "- [ ] Fix the ring snap @JARVIS 2026-09-27",
      done: false,
      text: "Fix the ring snap",
      project: "JARVIS",
      created: "2026-09-27",
    });
  });

  it("treats x and X as done, and a missing @ as personal", () => {
    expect(parseLine("- [x] Call the bank", 0)).toMatchObject({
      done: true,
      project: null,
      created: null,
    });
    expect(parseLine("- [X] Call the bank", 0)?.done).toBe(true);
  });

  it("keeps a date the user typed inside the text", () => {
    expect(parseLine("- [ ] Pay rent 2026-10-01 2026-09-27", 0)).toMatchObject({
      text: "Pay rent 2026-10-01",
      created: "2026-09-27",
    });
  });

  it("returns null for anything that is not a task", () => {
    for (const raw of ["# Todo", "", "- a note", "-[ ] x", "- [ ]", "- [ ] "])
      expect(parseLine(raw, 0)).toBeNull();
  });
});

describe("parseTodos", () => {
  it("keeps file line numbers and skips non-task lines", () => {
    const list = parseTodos("# Todo\n\n- [ ] a\n- [x] b @JARVIS\n");
    expect(list.todos.map((t) => [t.line, t.text])).toEqual([
      [2, "a"],
      [3, "b"],
    ]);
    expect(list.malformed).toEqual([]);
  });

  it("reports lines that start like a task but do not parse", () => {
    expect(parseTodos("-[ ] a\n* [ ] b\n- [ ]\n- note\n").malformed).toEqual([
      { line: 0, raw: "-[ ] a" },
      { line: 1, raw: "* [ ] b" },
      { line: 2, raw: "- [ ]" },
    ]);
  });

  it("reads an empty file as an empty list", () => {
    expect(parseTodos("")).toEqual({ todos: [], malformed: [] });
  });

  it("parses CRLF files without a trailing \\r on the text", () => {
    expect(parseTodos("- [ ] a\r\n- [ ] b\r\n").todos[1].text).toBe("b");
  });
});

describe("formatLine", () => {
  it("writes the canonical line and hyphenates a spaced project", () => {
    expect(
      formatLine({
        done: false,
        text: "Ship",
        project: "my app",
        created: TODAY,
      }),
    ).toBe("- [ ] Ship @my-app 2026-09-27");
    expect(
      formatLine({ done: true, text: "Ship", project: null, created: null }),
    ).toBe("- [x] Ship");
  });
});

describe("applyOp", () => {
  const file = "# Todo\n- [ ] a @JARVIS 2026-09-20\n- [ ] b 2026-09-21\n";

  it("add appends before the trailing newline and stamps today", () => {
    const r = applyOp(
      file,
      { kind: "add", text: " c ", project: "JARVIS" },
      TODAY,
    );
    expect(r).toEqual({
      ok: true,
      file: file + "- [ ] c @JARVIS 2026-09-27\n",
    });
  });

  it("add creates the first line of an empty file", () => {
    expect(
      applyOp("", { kind: "add", text: "a", project: null }, TODAY),
    ).toEqual({ ok: true, file: "- [ ] a 2026-09-27\n" });
  });

  it("add and edit collapse pasted newlines and refuse empty text", () => {
    const r = applyOp("", { kind: "add", text: "a\nb", project: null }, TODAY);
    expect(r.ok && r.file).toBe("- [ ] a b 2026-09-27\n");
    expect(
      applyOp("", { kind: "add", text: "  ", project: null }, TODAY),
    ).toEqual({ ok: false, error: "empty task" });

    const edited = applyOp(
      "- [ ] old\n",
      { kind: "edit", line: 0, raw: "- [ ] old", text: "a\nb", project: null },
      TODAY,
    );
    expect(edited.ok && edited.file).toBe("- [ ] a b\n");
    expect(
      applyOp(
        "- [ ] old\n",
        { kind: "edit", line: 0, raw: "- [ ] old", text: "  ", project: null },
        TODAY,
      ),
    ).toEqual({ ok: false, error: "empty task" });
  });

  it("add and edit refuse text that would read back as a project or date", () => {
    const refused = { ok: false, error: "text cannot end in @word or a date" };
    expect(
      applyOp("", { kind: "add", text: "ping @alice", project: null }, TODAY),
    ).toEqual(refused);
    expect(
      applyOp("", { kind: "add", text: "@home", project: null }, TODAY),
    ).toEqual(refused);
    expect(
      applyOp(
        "- [ ] old\n",
        {
          kind: "edit",
          line: 0,
          raw: "- [ ] old",
          text: "renew passport 2026-12-01",
          project: null,
        },
        TODAY,
      ),
    ).toEqual(refused);
    // a project after the text keeps an @word inside the text
    const r = applyOp(
      "",
      { kind: "add", text: "ping @alice", project: "JARVIS" },
      TODAY,
    );
    expect(r.ok && r.file).toBe("- [ ] ping @alice @JARVIS 2026-09-27\n");
  });

  it("toggle flips done and keeps project and date", () => {
    const r = applyOp(
      file,
      { kind: "toggle", line: 1, raw: "- [ ] a @JARVIS 2026-09-20" },
      TODAY,
    );
    expect(r.ok && r.file.split("\n")[1]).toBe("- [x] a @JARVIS 2026-09-20");
  });

  it("edit rewrites text and project and keeps the created date", () => {
    const r = applyOp(
      file,
      {
        kind: "edit",
        line: 2,
        raw: "- [ ] b 2026-09-21",
        text: "bee",
        project: "AeroGraph",
      },
      TODAY,
    );
    expect(r.ok && r.file.split("\n")[2]).toBe(
      "- [ ] bee @AeroGraph 2026-09-21",
    );
  });

  it("delete removes only that line", () => {
    const r = applyOp(
      file,
      { kind: "delete", line: 2, raw: "- [ ] b 2026-09-21" },
      TODAY,
    );
    expect(r).toEqual({
      ok: true,
      file: "# Todo\n- [ ] a @JARVIS 2026-09-20\n",
    });
  });

  it("move takes the target's place, in both directions", () => {
    const f = "- [ ] a\n- [ ] b\n- [ ] c\n";
    const down = applyOp(
      f,
      { kind: "move", line: 0, raw: "- [ ] a", toLine: 2, toRaw: "- [ ] c" },
      TODAY,
    );
    expect(down.ok && down.file).toBe("- [ ] b\n- [ ] c\n- [ ] a\n");
    const up = applyOp(
      f,
      { kind: "move", line: 2, raw: "- [ ] c", toLine: 0, toRaw: "- [ ] a" },
      TODAY,
    );
    expect(up.ok && up.file).toBe("- [ ] c\n- [ ] a\n- [ ] b\n");
  });

  it("refuses an op whose line text changed", () => {
    expect(
      applyOp(file, { kind: "toggle", line: 1, raw: "- [ ] old" }, TODAY),
    ).toEqual({ ok: false, error: "stale" });
    expect(
      applyOp(
        file,
        {
          kind: "move",
          line: 1,
          raw: "- [ ] a @JARVIS 2026-09-20",
          toLine: 2,
          toRaw: "- [ ] gone",
        },
        TODAY,
      ),
    ).toEqual({ ok: false, error: "stale" });
  });

  it("refuses an op that points at a non-task line", () => {
    expect(
      applyOp(file, { kind: "delete", line: 0, raw: "# Todo" }, TODAY),
    ).toEqual({ ok: false, error: "stale" });
  });

  it("keeps CRLF endings", () => {
    const crlf = "- [ ] a\r\n- [ ] b\r\n";
    const r = applyOp(crlf, { kind: "toggle", line: 1, raw: "- [ ] b" }, TODAY);
    expect(r.ok && r.file).toBe("- [ ] a\r\n- [x] b\r\n");
  });
});

describe("createTodoStore", () => {
  const memory = (initial: string) => {
    let file = initial;
    return {
      read: async () => file,
      write: async (next: string) => {
        await new Promise((r) => setTimeout(r, 5)); // widen the race window
        file = next;
      },
      get: () => file,
    };
  };

  it("runs concurrent ops one after another so neither write is lost", async () => {
    const io = memory("- [ ] a\n- [ ] b\n");
    const store = createTodoStore(io, () => TODAY);
    const [r1, r2] = await Promise.all([
      store.apply({ kind: "toggle", line: 0, raw: "- [ ] a" }),
      store.apply({ kind: "toggle", line: 1, raw: "- [ ] b" }),
    ]);
    expect([r1, r2]).toEqual([{ ok: true }, { ok: true }]);
    expect(io.get()).toBe("- [x] a\n- [x] b\n");
  });

  it("returns a refusal without writing", async () => {
    const io = memory("- [ ] a\n");
    const store = createTodoStore(io, () => TODAY);
    expect(
      await store.apply({ kind: "delete", line: 0, raw: "- [ ] z" }),
    ).toEqual({
      ok: false,
      error: "stale",
    });
    expect(io.get()).toBe("- [ ] a\n");
  });

  it("fails an add when the read fails, and never writes", async () => {
    let wrote = false;
    const store = createTodoStore(
      {
        read: () =>
          Promise.reject(Object.assign(new Error("busy"), { code: "EBUSY" })),
        write: async () => {
          wrote = true;
        },
      },
      () => TODAY,
    );
    await expect(
      store.apply({ kind: "add", text: "a", project: null }),
    ).rejects.toThrow("busy");
    expect(wrote).toBe(false);
  });

  it("keeps serving ops after one fails", async () => {
    let fail = true;
    const io = memory("- [ ] a\n");
    const store = createTodoStore(
      {
        read: () => (fail ? Promise.reject(new Error("busy")) : io.read()),
        write: io.write,
      },
      () => TODAY,
    );
    await expect(
      store.apply({ kind: "toggle", line: 0, raw: "- [ ] a" }),
    ).rejects.toThrow("busy");
    fail = false;
    expect(
      await store.apply({ kind: "toggle", line: 0, raw: "- [ ] a" }),
    ).toEqual({ ok: true });
  });

  it("list parses the current file", async () => {
    const store = createTodoStore(memory("- [ ] a\n"), () => TODAY);
    expect((await store.list()).todos).toHaveLength(1);
  });
});

describe("BOM", () => {
  it("reads the first task of a file saved with a byte order mark", () => {
    const list = parseTodos(
      String.fromCharCode(0xfeff) + "- [ ] a 2026-09-20\n",
    );
    expect(list.todos.map((t) => t.text)).toEqual(["a"]);
    expect(list.malformed).toEqual([]);
  });
});

describe("fileTodoIO", () => {
  it("reads a missing file as empty, and reads back what it wrote", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "todos-"));
    const io = fileTodoIO(path.join(dir, "TODO.md"));
    expect(await io.read()).toBe("");
    await io.write("- [ ] a\n");
    expect(await io.read()).toBe("- [ ] a\n");
    await fs.rm(dir, { recursive: true });
  });

  it("throws any other read error, so an add cannot overwrite the list", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "todos-"));
    // a directory named TODO.md: EISDIR, not ENOENT
    await fs.mkdir(path.join(dir, "TODO.md"));
    await expect(
      fileTodoIO(path.join(dir, "TODO.md")).read(),
    ).rejects.toThrow();
    await fs.rm(dir, { recursive: true });
  });
});
