import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseShellCommand } from "../../../src/main/agents/shell-reads";

const none = { reads: [], searches: [] };

const fixtureCommand = (name: string): unknown =>
  JSON.parse(
    readFileSync(
      path.join(__dirname, "..", "..", "fixtures", "codex", `${name}.json`),
      "utf8",
    ),
  ).tool_input.command;

describe("parseShellCommand", () => {
  it("reads the file of cat", () => {
    expect(parseShellCommand("cat src/a.ts")).toEqual({
      reads: ["src/a.ts"],
      searches: [],
    });
  });

  it("skips flag values without a path character in Get-Content", () => {
    expect(
      parseShellCommand("Get-Content -Path src\\a.ts -TotalCount 40"),
    ).toEqual({
      reads: ["src\\a.ts"],
      searches: [],
    });
  });

  it("never treats the sed script as a path", () => {
    expect(parseShellCommand("sed -n '1,80p' src/a.ts")).toEqual({
      reads: ["src/a.ts"],
      searches: [],
    });
  });

  it("takes the first non-flag word of rg as the pattern", () => {
    expect(parseShellCommand('rg -n "useHand" src')).toEqual({
      reads: [],
      searches: ["useHand"],
    });
  });

  it("treats git grep as a searcher", () => {
    expect(parseShellCommand("git grep foo")).toEqual({
      reads: [],
      searches: ["foo"],
    });
  });

  it("gives nothing for other git commands", () => {
    expect(parseShellCommand("git status")).toEqual(none);
  });

  it("splits a pipeline and a sequence", () => {
    expect(parseShellCommand("cat a.md | head -5; rg x .")).toEqual({
      reads: ["a.md"],
      searches: ["x"],
    });
  });

  it("removes a powershell wrapper", () => {
    expect(
      parseShellCommand(
        'powershell.exe -NoProfile -Command "Get-Content README.md"',
      ),
    ).toEqual({ reads: ["README.md"], searches: [] });
  });

  it("removes a bash wrapper and splits on &&", () => {
    expect(
      parseShellCommand('bash -lc "cat a.ts && grep -n foo b.ts"'),
    ).toEqual({
      reads: ["a.ts"],
      searches: ["foo"],
    });
  });

  it("gives nothing for npm test", () => {
    expect(parseShellCommand("npm test")).toEqual(none);
  });

  it.each([[""], [undefined], [42], [{}]])("gives nothing for %j", (input) => {
    expect(parseShellCommand(input)).toEqual(none);
  });

  it("does not split inside quotes", () => {
    expect(parseShellCommand('rg "a | b" src')).toEqual({
      reads: [],
      searches: ["a | b"],
    });
  });

  it("removes a wrapper at most once", () => {
    expect(parseShellCommand(`bash -c "bash -c 'cat a.ts'"`)).toEqual(none);
  });

  it("compares command names case-insensitively and without .exe", () => {
    expect(parseShellCommand("CAT.EXE a.ts")).toEqual({
      reads: ["a.ts"],
      searches: [],
    });
  });

  it("returns no duplicates", () => {
    expect(parseShellCommand("cat a.ts; cat a.ts; rg x; rg x")).toEqual({
      reads: ["a.ts"],
      searches: ["x"],
    });
  });

  it("uses the first non-flag word of a listing as its pattern", () => {
    expect(parseShellCommand("ls -la src")).toEqual({
      reads: [],
      searches: ["src"],
    });
    expect(parseShellCommand("ls")).toEqual(none);
  });

  it("accepts an array with a wrapper shape", () => {
    expect(parseShellCommand(["bash", "-lc", "cat a.ts"])).toEqual({
      reads: ["a.ts"],
      searches: [],
    });
  });

  it("joins a plain array with spaces", () => {
    expect(parseShellCommand(["cat", "src/a.ts"])).toEqual({
      reads: ["src/a.ts"],
      searches: [],
    });
  });

  it("gives nothing for an array with a non-string item", () => {
    expect(parseShellCommand(["cat", 5])).toEqual(none);
  });

  it("removes a wrapper once even when the array form was unwrapped", () => {
    expect(parseShellCommand(["bash", "-lc", "bash -c 'cat a.ts'"])).toEqual(
      none,
    );
  });

  it("drops reads after a folder change", () => {
    expect(parseShellCommand("cd src && cat a.ts")).toEqual(none);
    expect(parseShellCommand("cat a.ts; cd src; cat b.ts")).toEqual({
      reads: ["a.ts"],
      searches: [],
    });
    expect(parseShellCommand("cd src && rg foo .")).toEqual({
      reads: [],
      searches: ["foo"],
    });
    expect(parseShellCommand('bash -lc "cd src && cat a.ts"')).toEqual(none);
  });

  it("reads the recorded Codex read and search commands", () => {
    expect(parseShellCommand(fixtureCommand("pre-bash-read")).reads).toEqual([
      "README.md",
    ]);
    expect(
      parseShellCommand(fixtureCommand("pre-bash-search")).searches,
    ).toEqual(["greet"]);
  });

  it("skips the value of a search flag that takes one", () => {
    expect(parseShellCommand("rg -g '*.ts' -t ts foo src").searches).toEqual([
      "foo",
    ]);
  });
});
