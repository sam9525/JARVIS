import { describe, expect, it } from "vitest";
import { loginShellPath } from "../../src/main/shell-path";

describe("loginShellPath", () => {
  it("reads the fenced PATH past a shell banner", () => {
    const run = () =>
      "Welcome!\n__JARVIS_PATH__/opt/homebrew/bin:/usr/bin__JARVIS_PATH__\n";
    expect(loginShellPath("darwin", "/bin/zsh", run)).toBe(
      "/opt/homebrew/bin:/usr/bin",
    );
  });

  it("asks the user's own shell for a login PATH", () => {
    const calls: [string, string[]][] = [];
    loginShellPath("darwin", "/bin/bash", (file, args) => {
      calls.push([file, args]);
      return "";
    });
    expect(calls[0][0]).toBe("/bin/bash");
    expect(calls[0][1][0]).toBe("-ilc");
    // fish's `echo $PATH` prints space-separated words; printenv never does
    expect(calls[0][1][1]).toContain("printenv PATH");
  });

  it("drops the newline printenv leaves before the closing fence", () => {
    const run = () => "__JARVIS_PATH__/usr/local/bin:/usr/bin\n__JARVIS_PATH__";
    expect(loginShellPath("darwin", "/bin/zsh", run)).toBe(
      "/usr/local/bin:/usr/bin",
    );
  });

  it("skips Windows", () => {
    expect(loginShellPath("win32", "x", () => "unused")).toBeNull();
  });

  it("returns null when the shell fails or prints no PATH", () => {
    const boom = () => {
      throw new Error("timeout");
    };
    expect(loginShellPath("darwin", "/bin/zsh", boom)).toBeNull();
    expect(loginShellPath("darwin", "/bin/zsh", () => "nothing")).toBeNull();
  });
});
