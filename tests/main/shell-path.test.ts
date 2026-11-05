import { describe, expect, it } from "vitest";
import { loginShellPath, windowsPath } from "../../src/main/shell-path";

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

const MARK = "__JARVIS_PATH__";
const encoded = (path: string) =>
  `${MARK}${Buffer.from(path, "utf16le").toString("base64")}${MARK}\r\n`;
const LINKS = "C:\\Local\\Microsoft\\WinGet\\Links";
const yes = () => true;
const no = () => false;

describe("windowsPath", () => {
  it("joins Machine then User and appends the Links folder", () => {
    expect(windowsPath(() => encoded("C:\\m;D:\\u"), yes, "C:\\Local")).toBe(
      `C:\\m;D:\\u;${LINKS}`,
    );
  });

  it("omits the Links folder when it does not exist", () => {
    expect(windowsPath(() => encoded("C:\\m"), no, "C:\\Local")).toBe("C:\\m");
  });

  it("omits the Links folder when LOCALAPPDATA is unset", () => {
    // an explicit undefined would fall back to the real LOCALAPPDATA default
    expect(windowsPath(() => encoded("C:\\m"), yes, "")).toBe("C:\\m");
  });

  it("removes stray quotes and empty entries", () => {
    expect(
      windowsPath(
        () => encoded('C:\\m;;C:\\Program Files\\Tailscale";'),
        no,
        "C:\\Local",
      ),
    ).toBe("C:\\m;C:\\Program Files\\Tailscale");
  });

  it("keeps non-ASCII folder names", () => {
    expect(windowsPath(() => encoded("D:\\数据\\bin"), no, "C:\\Local")).toBe(
      "D:\\数据\\bin",
    );
  });

  it("reads past text printed around the fence", () => {
    expect(
      windowsPath(() => "WARNING: x\r\n" + encoded("C:\\m"), no, "C:\\Local"),
    ).toBe("C:\\m");
  });

  it("returns null when PowerShell fails", () => {
    const boom = () => {
      throw new Error("timeout");
    };
    expect(windowsPath(boom, yes, "C:\\Local")).toBeNull();
  });

  it("returns null without the fence", () => {
    expect(windowsPath(() => "nothing", yes, "C:\\Local")).toBeNull();
  });

  it("returns null when the stored PATH is empty", () => {
    expect(windowsPath(() => encoded(""), yes, "C:\\Local")).toBeNull();
    expect(windowsPath(() => encoded(";"), yes, "C:\\Local")).toBeNull();
  });

  it("asks PowerShell for both stored scopes", () => {
    const calls: [string, string[]][] = [];
    windowsPath(
      (file, args) => {
        calls.push([file, args]);
        return "";
      },
      yes,
      "C:\\Local",
    );
    const [file, args] = calls[0];
    expect(file).toBe("powershell.exe");
    expect(args).toContain("-NoProfile");
    expect(args).toContain("-NonInteractive");
    const script = args[args.length - 1];
    expect(script).toContain("'Machine'");
    expect(script).toContain("'User'");
  });

  it.runIf(process.platform === "win32")("reads the real stored PATH", () => {
    expect(windowsPath()?.toLowerCase()).toContain("system32");
  });
});
