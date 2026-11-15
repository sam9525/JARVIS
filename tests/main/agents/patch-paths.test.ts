import { describe, expect, it } from "vitest";
import { parsePatch } from "../../../src/main/agents/patch-paths";

const PATCH = [
  "*** Begin Patch",
  "*** Add File: src/c.ts",
  "+export const c = 1;",
  "*** Update File: src/b.ts",
  "@@",
  "-old",
  "+new",
  "*** Update File: src/old.ts",
  "*** Move to: src/new.ts",
  "@@",
  "-x",
  "+y",
  "*** Delete File: src/gone.ts",
  "*** End Patch",
].join("\n");

describe("parsePatch", () => {
  it("reads added and edited paths, using the new path of a move", () => {
    expect(parsePatch(PATCH)).toEqual({
      edited: ["src/b.ts", "src/new.ts"],
      added: ["src/c.ts"],
    });
  });

  it("returns empty arrays for non-string input", () => {
    for (const input of [undefined, null, 5, {}, ["*** Add File: a"]])
      expect(parsePatch(input)).toEqual({ edited: [], added: [] });
  });

  it("lists a path once and reads CRLF text", () => {
    const text = "*** Update File: a.ts\r\n*** Update File: a.ts\r\n";
    expect(parsePatch(text)).toEqual({ edited: ["a.ts"], added: [] });
  });
});
