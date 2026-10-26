import { describe, expect, it } from "vitest";
import {
  applyEntries,
  openCalls,
  patchCounts,
} from "../../src/renderer/session-screen/screen-state";
import type { ScreenEntry } from "../../src/shared/screen-types";

const prompt = (id: string): ScreenEntry => ({
  kind: "prompt",
  id,
  text: "hi",
});
const tool = (id: string): ScreenEntry => ({
  kind: "tool",
  id,
  name: "Bash",
  input: {},
});

describe("applyEntries", () => {
  it("appends in order", () => {
    const out = applyEntries([], [prompt("a"), prompt("b")], false);
    const more = applyEntries(out, [prompt("c")], false);
    expect(more.map((i) => i.id)).toEqual(["a", "b", "c"]);
  });

  it("reset replaces everything", () => {
    const old = applyEntries([], [prompt("a")], false);
    const out = applyEntries(old, [prompt("z")], true);
    expect(out.map((i) => i.id)).toEqual(["z"]);
  });

  it("a result attaches to its tool by id", () => {
    const out = applyEntries(
      [],
      [
        tool("t1"),
        {
          kind: "result",
          toolUseId: "t1",
          isError: true,
          text: "boom",
          patch: ["+x"],
        },
      ],
      false,
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      kind: "tool",
      result: { isError: true, text: "boom", patch: ["+x"] },
    });
  });

  it("a result in a later batch still attaches", () => {
    const first = applyEntries([], [tool("t1")], false);
    const out = applyEntries(
      first,
      [{ kind: "result", toolUseId: "t1", isError: false, text: "ok" }],
      false,
    );
    expect(openCalls(out)).toHaveLength(0);
    expect(first[0]).not.toHaveProperty("result");
  });

  it("a result with no tool is dropped", () => {
    const out = applyEntries(
      [],
      [{ kind: "result", toolUseId: "nope", isError: false, text: "x" }],
      false,
    );
    expect(out).toEqual([]);
  });

  it("an entry with a seen id is not added twice", () => {
    const once = applyEntries([], [prompt("a")], false);
    const twice = applyEntries(once, [prompt("a"), prompt("a")], false);
    expect(twice).toHaveLength(1);
  });

  it("entries with an empty id are never deduped", () => {
    const out = applyEntries([], [prompt(""), prompt("")], false);
    const again = applyEntries(out, [prompt("")], false);
    expect(again).toHaveLength(3);
  });
});

describe("openCalls", () => {
  it("lists tools without results", () => {
    const items = applyEntries(
      [],
      [
        tool("t1"),
        tool("t2"),
        { kind: "result", toolUseId: "t1", isError: false, text: "" },
      ],
      false,
    );
    expect(openCalls(items).map((t) => t.id)).toEqual(["t2"]);
  });
});

describe("patchCounts", () => {
  it("counts + and - lines, not context", () => {
    expect(patchCounts([" ctx", "+a", "+b", "-c", " more"])).toEqual({
      added: 2,
      removed: 1,
    });
  });
});
